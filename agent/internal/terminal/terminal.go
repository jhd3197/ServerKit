// Package terminal provides PTY (pseudo-terminal) support for remote shell sessions.
package terminal

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"runtime"
	"sync"

	"github.com/creack/pty"
)

// Session represents an active terminal session
type Session struct {
	ID       string
	Shell    string
	Cols     uint16
	Rows     uint16
	cmd      *exec.Cmd
	pty      *os.File
	ctx      context.Context
	cancel   context.CancelFunc
	mu       sync.Mutex
	closed   bool
	onOutput func(data []byte)
	onClose  func()
}

// Manager manages terminal sessions
type Manager struct {
	sessions map[string]*Session
	mu       sync.RWMutex
}

// NewManager creates a new terminal manager
func NewManager() *Manager {
	return &Manager{
		sessions: make(map[string]*Session),
	}
}

// CreateSession creates a new terminal session
func (m *Manager) CreateSession(id string, cols, rows uint16) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Check if session already exists
	if _, exists := m.sessions[id]; exists {
		return nil, fmt.Errorf("session %s already exists", id)
	}

	// Determine the shell to use
	shell := getDefaultShell()

	ctx, cancel := context.WithCancel(context.Background())

	session := &Session{
		ID:     id,
		Shell:  shell,
		Cols:   cols,
		Rows:   rows,
		ctx:    ctx,
		cancel: cancel,
	}

	// Start the shell with PTY
	if err := session.start(); err != nil {
		cancel()
		return nil, fmt.Errorf("failed to start shell: %w", err)
	}

	m.sessions[id] = session
	return session, nil
}

// GetSession retrieves a session by ID
func (m *Manager) GetSession(id string) (*Session, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	session, exists := m.sessions[id]
	return session, exists
}

// CloseSession closes and removes a session
func (m *Manager) CloseSession(id string) error {
	m.mu.Lock()
	session, exists := m.sessions[id]
	if exists {
		delete(m.sessions, id)
	}
	m.mu.Unlock()

	if !exists {
		return fmt.Errorf("session %s not found", id)
	}

	return session.Close()
}

// CloseAll closes all sessions
func (m *Manager) CloseAll() {
	m.mu.Lock()
	sessions := make([]*Session, 0, len(m.sessions))
	for _, s := range m.sessions {
		sessions = append(sessions, s)
	}
	m.sessions = make(map[string]*Session)
	m.mu.Unlock()

	for _, s := range sessions {
		s.Close()
	}
}

// ListSessions returns all active session IDs
func (m *Manager) ListSessions() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()

	ids := make([]string, 0, len(m.sessions))
	for id := range m.sessions {
		ids = append(ids, id)
	}
	return ids
}

// start initializes the PTY and starts the shell
func (s *Session) start() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Create the command
	s.cmd = exec.CommandContext(s.ctx, s.Shell)

	// Set up environment
	s.cmd.Env = append(os.Environ(),
		"TERM=xterm-256color",
		"COLORTERM=truecolor",
	)

	// Start with PTY
	ptmx, err := pty.StartWithSize(s.cmd, &pty.Winsize{
		Cols: s.Cols,
		Rows: s.Rows,
	})
	if err != nil {
		return fmt.Errorf("failed to start pty: %w", err)
	}

	s.pty = ptmx

	// Start reading output in background
	go s.readLoop()

	return nil
}

// readLoop continuously reads from the PTY and calls the output handler
func (s *Session) readLoop() {
	buf := make([]byte, 4096)

	for {
		select {
		case <-s.ctx.Done():
			return
		default:
		}

		n, err := s.pty.Read(buf)
		if err != nil {
			if err != io.EOF {
				// Log error but don't break - might be temporary
			}
			// Check if we should exit
			s.mu.Lock()
			closed := s.closed
			s.mu.Unlock()
			if closed {
				return
			}
			// Shell might have exited
			if s.onClose != nil {
				s.onClose()
			}
			return
		}

		if n > 0 && s.onOutput != nil {
			// Make a copy of the data
			data := make([]byte, n)
			copy(data, buf[:n])
			s.onOutput(data)
		}
	}
}

// Write sends input to the terminal
func (s *Session) Write(data []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.closed || s.pty == nil {
		return 0, fmt.Errorf("session is closed")
	}

	return s.pty.Write(data)
}

// Resize changes the terminal size
func (s *Session) Resize(cols, rows uint16) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.closed || s.pty == nil {
		return fmt.Errorf("session is closed")
	}

	s.Cols = cols
	s.Rows = rows

	return pty.Setsize(s.pty, &pty.Winsize{
		Cols: cols,
		Rows: rows,
	})
}

// SetOutputHandler sets the callback for terminal output
func (s *Session) SetOutputHandler(handler func(data []byte)) {
	s.onOutput = handler
}

// SetCloseHandler sets the callback for when the session closes
func (s *Session) SetCloseHandler(handler func()) {
	s.onClose = handler
}

// Close terminates the terminal session
func (s *Session) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.closed {
		return nil
	}

	s.closed = true
	s.cancel()

	var errs []error

	if s.pty != nil {
		if err := s.pty.Close(); err != nil {
			errs = append(errs, fmt.Errorf("failed to close pty: %w", err))
		}
	}

	if s.cmd != nil && s.cmd.Process != nil {
		if err := s.cmd.Process.Kill(); err != nil {
			// Process might have already exited
		}
	}

	if len(errs) > 0 {
		return errs[0]
	}
	return nil
}

// IsClosed returns whether the session is closed
func (s *Session) IsClosed() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.closed
}

// getDefaultShell returns the default shell for the current platform
func getDefaultShell() string {
	if runtime.GOOS == "windows" {
		// Try PowerShell first, fall back to cmd
		if _, err := exec.LookPath("powershell.exe"); err == nil {
			return "powershell.exe"
		}
		return "cmd.exe"
	}

	// Unix: try to get user's shell from environment
	if shell := os.Getenv("SHELL"); shell != "" {
		return shell
	}

	// Fall back to common shells
	shells := []string{"/bin/bash", "/bin/sh", "/bin/zsh"}
	for _, shell := range shells {
		if _, err := os.Stat(shell); err == nil {
			return shell
		}
	}

	return "/bin/sh"
}
