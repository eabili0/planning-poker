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
	Name string `json:"name"`
	Vote int    `json:"vote"`
}

type Session struct {
	ID           string                  `json:"id"`
	Participants map[string]*Participant `json:"participants"`
	Revealed     bool                    `json:"revealed"`
	mutex        sync.Mutex
	clients      map[*websocket.Conn]bool
}

var (
	sessions = make(map[string]*Session)
	upgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return true // Allow all origins for this example
		},
	}
)

const (
	tlsCertPath = "/opt/tls/server.crt"
	tlsKeyPath  = "/opt/tls/server.key"
)

func main() {
	// Create a new ServeMux
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
	if sessionID == "" {
		http.Error(w, "Missing session ID", http.StatusBadRequest)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println(err)
		return
	}
	defer conn.Close()

	session := getOrCreateSession(sessionID)
	session.clients[conn] = true

	for {
		messageType, p, err := conn.ReadMessage()
		if err != nil {
			log.Println(err)
			delete(session.clients, conn)
			break
		}

		var message map[string]interface{}
		if err := json.Unmarshal(p, &message); err != nil {
			log.Println(err)
			continue
		}

		switch message["type"] {
		case "join":
			handleJoin(session, message)
		case "vote":
			handleVote(session, message)
		case "reveal":
			handleReveal(session)
		case "reset":
			handleReset(session)
		}

		session.broadcastState(messageType)
	}
}

func getOrCreateSession(id string) *Session {
	if session, exists := sessions[id]; exists {
		return session
	}
	session := &Session{
		ID:           id,
		Participants: make(map[string]*Participant),
		clients:      make(map[*websocket.Conn]bool),
	}
	sessions[id] = session
	return session
}

func handleJoin(session *Session, message map[string]interface{}) {
	name, ok := message["name"].(string)
	if !ok {
		return
	}
	session.mutex.Lock()
	defer session.mutex.Unlock()
	session.Participants[name] = &Participant{Name: name}
}

func handleVote(session *Session, message map[string]interface{}) {
	name, ok1 := message["name"].(string)
	vote, ok2 := message["vote"].(float64)
	if !ok1 || !ok2 {
		return
	}
	session.mutex.Lock()
	defer session.mutex.Unlock()
	if participant, exists := session.Participants[name]; exists {
		participant.Vote = int(vote)
	}
}

func handleReveal(session *Session) {
	session.mutex.Lock()
	defer session.mutex.Unlock()
	session.Revealed = true
}

func handleReset(session *Session) {
	session.mutex.Lock()
	defer session.mutex.Unlock()
	session.Revealed = false
	for _, participant := range session.Participants {
		participant.Vote = 0
	}
}

func (s *Session) broadcastState(messageType int) {
	s.mutex.Lock()
	state, _ := json.Marshal(s)
	s.mutex.Unlock()

	for client := range s.clients {
		err := client.WriteMessage(messageType, state)
		if err != nil {
			log.Println(err)
			client.Close()
			delete(s.clients, client)
		}
	}
}
