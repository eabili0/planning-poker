package main

import (
	"crypto/tls"
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

type Participant struct {
	Name     string `json:"name"`
	Vote     int    `json:"vote"`  // -1 represents "No Vote/Question"
	IsAdmin  bool   `json:"isAdmin"`
	IsActive bool   `json:"isActive"`
}


type Session struct {
	ID           string                  `json:"id"`
	Participants map[string]*Participant `json:"participants"`
	Revealed     bool                    `json:"revealed"`
	mutex        sync.Mutex
	clients      map[*websocket.Conn]string // Map WebSocket to participant name
}

var (
	sessions = make(map[string]*Session)
	upgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return true
		},
	}
)

const (
	tlsCertPath = "/opt/tls/server.crt"
	tlsKeyPath  = "/opt/tls/server.key"
)

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/wss", handleWebSocket)

	// Configure the TLS settings
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

	// Create a new http.Server with the TLS configuration
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
	isAdmin := r.URL.Query().Get("admin") == "true"

	if sessionID == "" || name == "" {
		http.Error(w, "Missing session ID or name", http.StatusBadRequest)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println(err)
		return
	}
	defer conn.Close()

	session := getOrCreateSession(sessionID)
	session.mutex.Lock()
	isNewUser := false
	if _, exists := session.Participants[name]; !exists {
		session.Participants[name] = &Participant{Name: name, IsAdmin: isAdmin, IsActive: true, Vote: 0}
		isNewUser = true
	} else {
		session.Participants[name].IsActive = true
		session.Participants[name].IsAdmin = isAdmin
	}
	session.clients[conn] = name
	session.mutex.Unlock()

	// Broadcast updated session state to all clients if a new user joined
	if isNewUser {
		broadcastSessionState(session)
	} else {
		// Send initial state only to the current connection
		sendSessionState(conn, session)
	}

	defer func() {
		removeParticipant(session, name)
		broadcastSessionState(session) // Broadcast update when a user disconnects
	}()

	for {
		_, p, err := conn.ReadMessage()
		if err != nil {
			log.Println("Read error: ", err)
			return // This will trigger the deferred removeParticipant call
		}

		var message map[string]interface{}
		if err := json.Unmarshal(p, &message); err != nil {
			log.Println(err)
			continue
		}

		switch message["type"] {
		case "vote":
			handleVote(session, name, message["vote"])
		case "reveal":
			handleReveal(session, name)
		case "reset":
			handleReset(session, name)
		case "remove":
			handleRemove(session, name, message["targetName"].(string))
		case "cleanup":
			handleCleanup(session, name)
		case "ping":
			// Respond to ping with a pong
			conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"pong"}`))
			continue // Skip broadcasting for pings
		}

		broadcastSessionState(session)
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

func handleVote(session *Session, name string, voteValue interface{}) {
	session.mutex.Lock()
	defer session.mutex.Unlock()
	if participant, exists := session.Participants[name]; exists && !participant.IsAdmin {
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

func handleReveal(session *Session, name string) {
	session.mutex.Lock()
	defer session.mutex.Unlock()
	if participant, exists := session.Participants[name]; exists && participant.IsAdmin {
		session.Revealed = true
	}
}

func handleReset(session *Session, name string) {
	session.mutex.Lock()
	defer session.mutex.Unlock()
	if participant, exists := session.Participants[name]; exists && participant.IsAdmin {
		session.Revealed = false
		for _, p := range session.Participants {
			p.Vote = 0  // Reset vote to 0, which represents "Not voted"
		}
	}
}

func handleRemove(session *Session, adminName, targetName string) {
	session.mutex.Lock()
	defer session.mutex.Unlock()
	if admin, exists := session.Participants[adminName]; exists && admin.IsAdmin {
		delete(session.Participants, targetName)
	}
}

func handleCleanup(session *Session, name string) {
	session.mutex.Lock()
	defer session.mutex.Unlock()
	if participant, exists := session.Participants[name]; exists && participant.IsAdmin {
		for name, p := range session.Participants {
			if !p.IsActive {
				delete(session.Participants, name)
			}
		}
	}
}

func removeParticipant(session *Session, name string) {
	session.mutex.Lock()
	defer session.mutex.Unlock()
	
	// Fully remove the participant from the session
	delete(session.Participants, name)
	
	// Remove the participant's connection from the clients map
	for conn, participantName := range session.clients {
		if participantName == name {
			delete(session.clients, conn)
			conn.Close() // Ensure the connection is closed
			break
		}
	}
}

func sendSessionState(conn *websocket.Conn, session *Session) {
	session.mutex.Lock()
	defer session.mutex.Unlock()
	state, _ := json.Marshal(session)
	conn.WriteMessage(websocket.TextMessage, state)
}

func broadcastSessionState(session *Session) {
	session.mutex.Lock()
	defer session.mutex.Unlock()
	state, _ := json.Marshal(session)
	for conn := range session.clients {
		conn.WriteMessage(websocket.TextMessage, state)
	}
}
