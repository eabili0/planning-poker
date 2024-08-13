package main

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

type Participant struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Vote     int    `json:"vote"`
	IsAdmin  bool   `json:"isAdmin"`
	IsActive bool   `json:"isActive"`
}

type Session struct {
	ID           string                  `json:"id"`
	Participants map[string]*Participant `json:"participants"`
	Revealed     bool                    `json:"revealed"`
	mutex        sync.Mutex
	clients      map[*websocket.Conn]string
}

var (
	sessions = make(map[string]*Session)
	upgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return true
		},
		HandshakeTimeout: 10 * time.Second,
	}
)

const (
	tlsCertPath = "/opt/tls/server.crt"
	tlsKeyPath  = "/opt/tls/server.key"
)

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/wss", handleWebSocket)

	tlsConfig := &tls.Config{
		MinVersion:               tls.VersionTLS12,
		CurvePreferences:         []tls.CurveID{tls.CurveP521, tls.CurveP384, tls.CurveP256},
		PreferServerCipherSuites: true,
		CipherSuites: []uint16{
			tls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
			tls.TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA,
			tls.TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,
			tls.TLS_RSA_WITH_AES_256_GCM_SHA384,
			tls.TLS_RSA_WITH_AES_256_CBC_SHA,
		},
	}

	server := &http.Server{
		Addr:      ":8443",
		Handler:   mux,
		TLSConfig: tlsConfig,
	}

	go func() {
		log.Println("Server starting on :8443 with WSS support")
		log.Fatal(server.ListenAndServeTLS(tlsCertPath, tlsKeyPath))
	}()

	http.HandleFunc("/ws", handleWebSocket)
	log.Println("Server starting on :8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("session")
	name := r.URL.Query().Get("name")
	participantID := r.URL.Query().Get("id")
	isAdmin := r.URL.Query().Get("admin") == "true"

	if sessionID == "" || name == "" {
		log.Printf("Missing session ID or name: %s, %s", sessionID, name)
		http.Error(w, "Missing session ID or name", http.StatusBadRequest)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}
	defer conn.Close()

	log.Printf("New WebSocket connection: %s, %s, %s", sessionID, name, participantID)

	session := getOrCreateSession(sessionID)
	session.mutex.Lock()

	if participantID == "" {
		participantID = uuid.New().String()
	}

	if _, exists := session.Participants[participantID]; !exists {
		session.Participants[participantID] = &Participant{ID: participantID, Name: name, IsAdmin: isAdmin, IsActive: true, Vote: 0}
	} else {
		session.Participants[participantID].Name = name
		session.Participants[participantID].IsActive = true
		session.Participants[participantID].IsAdmin = isAdmin
	}
	session.clients[conn] = participantID
	session.mutex.Unlock()

	// Send initial session state
	if err := sendSessionState(conn, session); err != nil {
		log.Printf("Failed to send initial session state: %v", err)
		return
	}

	broadcastSessionState(session)

	defer func() {
		removeParticipant(session, participantID)
		broadcastSessionState(session)
		log.Printf("WebSocket connection closed: %s, %s", sessionID, participantID)
	}()

	conn.SetReadLimit(1024) // Increased read limit

	for {
		messageType, p, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("Unexpected WebSocket close error: %v", err)
			}
			return
		}

		if messageType != websocket.TextMessage {
			log.Printf("Received non-text message: %d", messageType)
			continue
		}

		var message map[string]interface{}
		if err := json.Unmarshal(p, &message); err != nil {
			log.Printf("Failed to unmarshal message: %v", err)
			continue
		}

		log.Printf("Received message: %v", message)

		switch message["type"] {
		case "vote":
			handleVote(session, participantID, message["vote"])
		case "reveal":
			handleReveal(session, participantID)
		case "reset":
			handleReset(session, participantID)
		case "remove":
			handleRemove(session, participantID, message["targetId"].(string))
		case "cleanup":
			handleCleanup(session, participantID)
		case "changeName":
			handleChangeName(session, participantID, message["newName"].(string), conn)
		case "changeRole":
			handleRoleChange(session, participantID, message["newRole"].(bool), conn)
		case "ping":
			if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"pong"}`)); err != nil {
				log.Printf("Failed to send pong: %v", err)
				return
			}
			continue
		default:
			log.Printf("Unknown message type: %v", message["type"])
		}

		if err := broadcastSessionState(session); err != nil {
			log.Printf("Failed to broadcast session state: %v", err)
			return
		}
	}
}

func getOrCreateSession(id string) *Session {
	if session, exists := sessions[id]; exists {
		return session
	}
	session := &Session{
		ID:           id,
		Participants: make(map[string]*Participant),
		clients:      make(map[*websocket.Conn]string),
	}
	sessions[id] = session
	return session
}

func handleVote(session *Session, participantID string, voteValue interface{}) {
	session.mutex.Lock()
	defer session.mutex.Unlock()
	if participant, exists := session.Participants[participantID]; exists && !participant.IsAdmin {
		switch v := voteValue.(type) {
		case float64:
			participant.Vote = int(v)
		case string:
			if v == "no-vote" {
				participant.Vote = -1
			}
		}
	}
}

func handleReveal(session *Session, participantID string) {
	session.mutex.Lock()
	defer session.mutex.Unlock()
	if participant, exists := session.Participants[participantID]; exists && participant.IsAdmin {
		session.Revealed = true
	}
}

func handleReset(session *Session, participantID string) {
	session.mutex.Lock()
	defer session.mutex.Unlock()
	if participant, exists := session.Participants[participantID]; exists && participant.IsAdmin {
		session.Revealed = false
		for _, p := range session.Participants {
			p.Vote = 0
		}
	}
}

func handleRemove(session *Session, adminID, targetID string) {
	session.mutex.Lock()
	defer session.mutex.Unlock()
	if admin, exists := session.Participants[adminID]; exists && admin.IsAdmin {
		delete(session.Participants, targetID)
	}
}

func handleCleanup(session *Session, participantID string) {
	session.mutex.Lock()
	defer session.mutex.Unlock()
	if participant, exists := session.Participants[participantID]; exists && participant.IsAdmin {
		for id, p := range session.Participants {
			if !p.IsActive {
				delete(session.Participants, id)
			}
		}
	}
}

func handleChangeName(session *Session, participantID, newName string, conn *websocket.Conn) {
	session.mutex.Lock()
	defer session.mutex.Unlock()

	if participant, exists := session.Participants[participantID]; exists {
		participant.Name = newName
		conn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf(`{"type":"nameChangeConfirmation","newName":"%s"}`, newName)))
	}
}

func handleRoleChange(session *Session, participantID string, newRole bool, conn *websocket.Conn) {
	session.mutex.Lock()
	defer session.mutex.Unlock()

	if participant, exists := session.Participants[participantID]; exists {
		participant.IsAdmin = newRole
		log.Printf("Role changed for participant %s to admin: %v", participantID, newRole)

		// Send confirmation to the client
		confirmation := map[string]interface{}{
			"type":    "roleChangeConfirmation",
			"newRole": newRole,
		}
		confirmationJSON, err := json.Marshal(confirmation)
		if err != nil {
			log.Printf("Failed to marshal role change confirmation: %v", err)
			return
		}
		if err := conn.WriteMessage(websocket.TextMessage, confirmationJSON); err != nil {
			log.Printf("Failed to send role change confirmation: %v", err)
			return
		}
	} else {
		log.Printf("Participant %s not found for role change", participantID)
	}
}

func boolToString(b bool) string {
	if b {
		return "true"
	}
	return "false"
}

func removeParticipant(session *Session, participantID string) {
	session.mutex.Lock()
	defer session.mutex.Unlock()

	delete(session.Participants, participantID)

	for conn, id := range session.clients {
		if id == participantID {
			delete(session.clients, conn)
			conn.Close()
			break
		}
	}
}

func sendSessionState(conn *websocket.Conn, session *Session) error {
	session.mutex.Lock()
	defer session.mutex.Unlock()
	state, err := json.Marshal(session)
	if err != nil {
		return fmt.Errorf("failed to marshal session state: %v", err)
	}
	if err := conn.WriteMessage(websocket.TextMessage, state); err != nil {
		return fmt.Errorf("failed to send session state: %v", err)
	}
	return nil
}

func broadcastSessionState(session *Session) error {
	session.mutex.Lock()
	defer session.mutex.Unlock()
	state, err := json.Marshal(session)
	if err != nil {
		return fmt.Errorf("failed to marshal session state: %v", err)
	}
	for conn := range session.clients {
		if err := conn.WriteMessage(websocket.TextMessage, state); err != nil {
			log.Printf("Failed to send session state to a client: %v", err)
			delete(session.clients, conn)
			conn.Close()
		}
	}
	return nil
}
