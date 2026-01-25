package ipc

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/serverkit/agent/internal/logger"
)

// Handlers contains the HTTP handlers for the IPC API
type Handlers struct {
	provider StatusProvider
	log      *logger.Logger
}

// NewHandlers creates a new handlers instance
func NewHandlers(provider StatusProvider, log *logger.Logger) *Handlers {
	return &Handlers{
		provider: provider,
		log:      log,
	}
}

// HandleStatus returns the current agent status
func (h *Handlers) HandleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	status := h.provider.GetStatus()
	h.writeJSON(w, status)
}

// HandleMetrics returns detailed system metrics
func (h *Handlers) HandleMetrics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	metrics := h.provider.GetDetailedMetrics()
	if metrics == nil {
		h.writeJSON(w, map[string]string{"error": "metrics not available"})
		return
	}

	h.writeJSON(w, metrics)
}

// HandleConnection returns WebSocket connection information
func (h *Handlers) HandleConnection(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	info := h.provider.GetConnectionInfo()
	h.writeJSON(w, info)
}

// HandleLogs returns recent log lines
func (h *Handlers) HandleLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse lines parameter (default 50)
	lines := 50
	if l := r.URL.Query().Get("lines"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 && parsed <= 1000 {
			lines = parsed
		}
	}

	logs := h.provider.GetRecentLogs(lines)
	h.writeJSON(w, map[string]interface{}{
		"lines": logs,
		"count": len(logs),
	})
}

// HandleRestart triggers a graceful agent restart
func (h *Handlers) HandleRestart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	h.log.Info("Restart requested via IPC")

	if err := h.provider.Restart(); err != nil {
		h.writeJSON(w, map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	h.writeJSON(w, map[string]interface{}{
		"success": true,
		"message": "Restart initiated",
	})
}

// HandleHealth returns a simple health check response
func (h *Handlers) HandleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	status := h.provider.GetStatus()
	h.writeJSON(w, map[string]interface{}{
		"healthy":   status.Running,
		"connected": status.Connected,
	})
}

// writeJSON writes a JSON response
func (h *Handlers) writeJSON(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(data); err != nil {
		h.log.Warn("Failed to encode JSON response", "error", err)
	}
}
