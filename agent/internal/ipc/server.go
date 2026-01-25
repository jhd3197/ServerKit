package ipc

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"time"

	"github.com/serverkit/agent/internal/config"
	"github.com/serverkit/agent/internal/logger"
)

// StatusProvider provides agent status information
type StatusProvider interface {
	GetStatus() AgentStatus
	GetDetailedMetrics() *DetailedMetrics
	GetConnectionInfo() ConnectionInfo
	GetRecentLogs(lines int) []string
	Restart() error
}

// AgentStatus represents the current agent status
type AgentStatus struct {
	Running     bool    `json:"running"`
	Connected   bool    `json:"connected"`
	Registered  bool    `json:"registered"`
	AgentID     string  `json:"agent_id"`
	AgentName   string  `json:"agent_name"`
	ServerURL   string  `json:"server_url"`
	Uptime      int64   `json:"uptime_seconds"`
	Version     string  `json:"version"`
	CPUPercent  float64 `json:"cpu_percent"`
	MemPercent  float64 `json:"mem_percent"`
	DiskPercent float64 `json:"disk_percent"`
}

// DetailedMetrics contains detailed system metrics
type DetailedMetrics struct {
	CPU       CPUMetrics    `json:"cpu"`
	Memory    MemoryMetrics `json:"memory"`
	Disk      DiskMetrics   `json:"disk"`
	Network   NetworkMetrics `json:"network"`
	Timestamp int64          `json:"timestamp"`
}

// CPUMetrics contains CPU information
type CPUMetrics struct {
	UsagePercent float64   `json:"usage_percent"`
	PerCPU       []float64 `json:"per_cpu,omitempty"`
	Cores        int       `json:"cores"`
}

// MemoryMetrics contains memory information
type MemoryMetrics struct {
	Total        uint64  `json:"total"`
	Used         uint64  `json:"used"`
	Free         uint64  `json:"free"`
	UsagePercent float64 `json:"usage_percent"`
}

// DiskMetrics contains disk information
type DiskMetrics struct {
	Total        uint64  `json:"total"`
	Used         uint64  `json:"used"`
	Free         uint64  `json:"free"`
	UsagePercent float64 `json:"usage_percent"`
}

// NetworkMetrics contains network information
type NetworkMetrics struct {
	BytesSent   uint64 `json:"bytes_sent"`
	BytesRecv   uint64 `json:"bytes_recv"`
	PacketsSent uint64 `json:"packets_sent"`
	PacketsRecv uint64 `json:"packets_recv"`
}

// ConnectionInfo contains WebSocket connection details
type ConnectionInfo struct {
	Connected      bool   `json:"connected"`
	ServerURL      string `json:"server_url"`
	ReconnectCount int    `json:"reconnect_count"`
	LastConnected  int64  `json:"last_connected,omitempty"`
	SessionExpires int64  `json:"session_expires,omitempty"`
}

// Server is the IPC HTTP server for tray app communication
type Server struct {
	cfg      config.IPCConfig
	log      *logger.Logger
	server   *http.Server
	provider StatusProvider
	startTime time.Time
}

// NewServer creates a new IPC server
func NewServer(cfg config.IPCConfig, log *logger.Logger, provider StatusProvider) *Server {
	return &Server{
		cfg:       cfg,
		log:       log.WithComponent("ipc"),
		provider:  provider,
		startTime: time.Now(),
	}
}

// Start starts the IPC HTTP server
func (s *Server) Start(ctx context.Context) error {
	if !s.cfg.Enabled {
		s.log.Info("IPC server disabled")
		return nil
	}

	mux := http.NewServeMux()

	// Register handlers
	handlers := NewHandlers(s.provider, s.log)
	mux.HandleFunc("/status", handlers.HandleStatus)
	mux.HandleFunc("/metrics", handlers.HandleMetrics)
	mux.HandleFunc("/connection", handlers.HandleConnection)
	mux.HandleFunc("/logs", handlers.HandleLogs)
	mux.HandleFunc("/restart", handlers.HandleRestart)
	mux.HandleFunc("/health", handlers.HandleHealth)

	addr := fmt.Sprintf("%s:%d", s.cfg.Address, s.cfg.Port)

	// Verify we're only binding to localhost for security
	host, _, err := net.SplitHostPort(addr)
	if err != nil || (host != "127.0.0.1" && host != "localhost" && host != "::1") {
		s.log.Warn("IPC server can only bind to localhost, forcing 127.0.0.1")
		addr = fmt.Sprintf("127.0.0.1:%d", s.cfg.Port)
	}

	s.server = &http.Server{
		Addr:         addr,
		Handler:      corsMiddleware(mux),
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	s.log.Info("Starting IPC server", "address", addr)

	// Start server in goroutine
	errCh := make(chan error, 1)
	go func() {
		if err := s.server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
	}()

	// Check for immediate startup errors
	select {
	case err := <-errCh:
		return fmt.Errorf("IPC server failed to start: %w", err)
	case <-time.After(100 * time.Millisecond):
		// Server started successfully
	}

	// Wait for context cancellation
	go func() {
		<-ctx.Done()
		s.Stop()
	}()

	return nil
}

// Stop gracefully stops the IPC server
func (s *Server) Stop() error {
	if s.server == nil {
		return nil
	}

	s.log.Info("Stopping IPC server")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	return s.server.Shutdown(ctx)
}

// corsMiddleware adds CORS headers for local development
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Only allow requests from localhost
		origin := r.Header.Get("Origin")
		if origin == "" || isLocalhost(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		}

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// isLocalhost checks if the origin is from localhost
func isLocalhost(origin string) bool {
	return origin == "http://localhost" ||
		origin == "https://localhost" ||
		origin == "http://127.0.0.1" ||
		origin == "https://127.0.0.1" ||
		len(origin) > 17 && origin[:17] == "http://localhost:" ||
		len(origin) > 18 && origin[:18] == "https://localhost:" ||
		len(origin) > 17 && origin[:17] == "http://127.0.0.1:" ||
		len(origin) > 18 && origin[:18] == "https://127.0.0.1:"
}
