package httpserver

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// SSEEvent represents an event to be sent to SSE clients.
type SSEEvent struct {
	Type      string `json:"type"`
	AppID     int64  `json:"app_id,omitempty"`
	Timestamp string `json:"timestamp"`
	Data      any    `json:"data,omitempty"`
}

// SSEBroker manages SSE client connections and event broadcasting.
type SSEBroker struct {
	mu          sync.RWMutex
	clients     map[chan SSEEvent]struct{}
	register    chan chan SSEEvent
	unregister  chan chan SSEEvent
	broadcast   chan SSEEvent
	closed      bool
}

// NewSSEBroker creates a new SSE broker and starts its event loop.
func NewSSEBroker() *SSEBroker {
	b := &SSEBroker{
		clients:    make(map[chan SSEEvent]struct{}),
		register:   make(chan chan SSEEvent),
		unregister: make(chan chan SSEEvent),
		broadcast:  make(chan SSEEvent, 100), // Buffered to prevent blocking
	}
	go b.run()
	return b
}

func (b *SSEBroker) run() {
	for {
		select {
		case client := <-b.register:
			b.mu.Lock()
			b.clients[client] = struct{}{}
			b.mu.Unlock()

		case client := <-b.unregister:
			b.mu.Lock()
			if _, ok := b.clients[client]; ok {
				delete(b.clients, client)
				close(client)
			}
			b.mu.Unlock()

		case event := <-b.broadcast:
			b.mu.RLock()
			for client := range b.clients {
				select {
				case client <- event:
				default:
					// Client buffer full, skip this event for this client
				}
			}
			b.mu.RUnlock()
		}
	}
}

// Subscribe adds a new client and returns its event channel.
func (b *SSEBroker) Subscribe() chan SSEEvent {
	client := make(chan SSEEvent, 10)
	b.register <- client
	return client
}

// Unsubscribe removes a client.
func (b *SSEBroker) Unsubscribe(client chan SSEEvent) {
	b.unregister <- client
}

// Publish sends an event to all connected clients.
func (b *SSEBroker) Publish(event SSEEvent) {
	if event.Timestamp == "" {
		event.Timestamp = time.Now().UTC().Format(time.RFC3339)
	}
	select {
	case b.broadcast <- event:
	default:
		// Broadcast buffer full, event dropped
	}
}

// PublishPolicyUpdate publishes a policy update event.
func (b *SSEBroker) PublishPolicyUpdate(appID int64, action string) {
	b.Publish(SSEEvent{
		Type:  "policy_updated",
		AppID: appID,
		Data:  map[string]string{"action": action},
	})
}

// PublishEntityUpdate publishes an entity update event.
func (b *SSEBroker) PublishEntityUpdate(appID int64) {
	b.Publish(SSEEvent{
		Type:  "entity_updated",
		AppID: appID,
	})
}

// ClientCount returns the number of connected clients.
func (b *SSEBroker) ClientCount() int {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return len(b.clients)
}

// handleSSEEvents handles the SSE endpoint for real-time policy updates.
// @Summary Subscribe to Policy Events (SSE)
// @Description Server-Sent Events endpoint for real-time policy and entity change notifications
// @Tags Events
// @Produce text/event-stream
// @Security ApiKeyAuth
// @Security BearerAuth
// @Param app_id query int false "Filter events by Application ID"
// @Success 200 {string} string "SSE stream"
// @Router /v1/events [get]
func (a *API) handleSSEEvents(w http.ResponseWriter, r *http.Request) {
	// Check if SSE broker is available
	if a.sseBroker == nil {
		http.Error(w, "SSE not available", http.StatusServiceUnavailable)
		return
	}

	// Set SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	// Optional: filter by app_id
	var filterAppID int64
	if appIDStr := r.URL.Query().Get("app_id"); appIDStr != "" {
		if id, err := parseIDParam(r, ""); err == nil {
			filterAppID = id
		}
	}

	// Subscribe to events
	client := a.sseBroker.Subscribe()
	defer a.sseBroker.Unsubscribe(client)

	// Get the flusher for streaming
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "SSE not supported", http.StatusInternalServerError)
		return
	}

	// Send initial connection event
	initialEvent := SSEEvent{
		Type:      "connected",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Data:      map[string]any{"message": "Connected to Cedar policy events"},
	}
	data, _ := json.Marshal(initialEvent)
	fmt.Fprintf(w, "event: %s\ndata: %s\n\n", initialEvent.Type, data)
	flusher.Flush()

	// Keep-alive ticker
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	// Stream events
	for {
		select {
		case <-r.Context().Done():
			return

		case event := <-client:
			// Apply app_id filter if specified
			if filterAppID > 0 && event.AppID != filterAppID {
				continue
			}

			data, err := json.Marshal(event)
			if err != nil {
				continue
			}
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event.Type, data)
			flusher.Flush()

		case <-ticker.C:
			// Send keep-alive comment
			fmt.Fprintf(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}

