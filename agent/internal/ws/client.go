package ws

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/serverkit/agent/internal/auth"
	"github.com/serverkit/agent/internal/config"
	"github.com/serverkit/agent/internal/logger"
	"github.com/serverkit/agent/pkg/protocol"
)

// MessageHandler is called when a message is received
type MessageHandler func(msgType protocol.MessageType, data []byte)

// Client is a WebSocket client with auto-reconnect
type Client struct {
	cfg           config.ServerConfig
	auth          *auth.Authenticator
	log           *logger.Logger
	conn          *websocket.Conn
	handler       MessageHandler
	session       *auth.SessionToken

	mu            sync.RWMutex
	connected     bool
	reconnecting  bool

	sendCh        chan []byte
	doneCh        chan struct{}

	reconnectCount int
}

// NewClient creates a new WebSocket client
func NewClient(cfg config.ServerConfig, authenticator *auth.Authenticator, log *logger.Logger) *Client {
	return &Client{
		cfg:    cfg,
		auth:   authenticator,
		log:    log.WithComponent("websocket"),
		sendCh: make(chan []byte, 100),
		doneCh: make(chan struct{}),
	}
}

// SetHandler sets the message handler
func (c *Client) SetHandler(handler MessageHandler) {
	c.handler = handler
}

// Connect establishes a WebSocket connection
func (c *Client) Connect(ctx context.Context) error {
	c.mu.Lock()
	if c.connected {
		c.mu.Unlock()
		return nil
	}
	c.mu.Unlock()

	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
	}

	// Allow insecure for development
	if c.cfg.InsecureSkipVerify {
		dialer.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
	}

	// Add authentication headers
	headers := http.Header{}
	headers.Set("X-Agent-ID", c.auth.AgentID())
	headers.Set("X-API-Key-Prefix", c.auth.GetAPIKeyPrefix())

	c.log.Debug("Connecting to server", "url", c.cfg.URL)

	conn, resp, err := dialer.DialContext(ctx, c.cfg.URL, headers)
	if err != nil {
		if resp != nil {
			c.log.Error("Connection failed",
				"error", err,
				"status", resp.StatusCode,
			)
		}
		return fmt.Errorf("failed to connect: %w", err)
	}

	c.mu.Lock()
	c.conn = conn
	c.connected = true
	c.reconnecting = false
	c.reconnectCount = 0
	c.mu.Unlock()

	c.log.Info("Connected to server")

	// Authenticate
	if err := c.authenticate(); err != nil {
		c.Close()
		return fmt.Errorf("authentication failed: %w", err)
	}

	return nil
}

// authenticate sends authentication message and waits for response
func (c *Client) authenticate() error {
	timestamp := time.Now().UnixMilli()
	nonce := auth.GenerateNonce()
	// Sign with nonce for replay protection
	signature := c.auth.SignMessageWithNonce(timestamp, nonce)

	authMsg := protocol.AuthMessage{
		Message:      protocol.NewMessage(protocol.TypeAuth, nonce),
		AgentID:      c.auth.AgentID(),
		APIKeyPrefix: c.auth.GetAPIKeyPrefix(),
		Nonce:        nonce,
	}
	authMsg.Timestamp = timestamp
	authMsg.Signature = signature

	data, err := json.Marshal(authMsg)
	if err != nil {
		return fmt.Errorf("failed to marshal auth message: %w", err)
	}

	c.log.Debug("Sending authentication message")

	if err := c.conn.WriteMessage(websocket.TextMessage, data); err != nil {
		return fmt.Errorf("failed to send auth message: %w", err)
	}

	// Wait for auth response
	c.conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	_, msg, err := c.conn.ReadMessage()
	if err != nil {
		return fmt.Errorf("failed to read auth response: %w", err)
	}
	c.conn.SetReadDeadline(time.Time{})

	var response protocol.AuthResponse
	if err := json.Unmarshal(msg, &response); err != nil {
		return fmt.Errorf("failed to parse auth response: %w", err)
	}

	if response.Type == protocol.TypeAuthFail {
		return fmt.Errorf("authentication rejected: %s", response.Error)
	}

	if response.Type != protocol.TypeAuthOK {
		return fmt.Errorf("unexpected response type: %s", response.Type)
	}

	// Store session token
	c.session = &auth.SessionToken{
		Token:     response.SessionToken,
		ExpiresAt: time.UnixMilli(response.Expires),
	}

	c.log.Info("Authentication successful",
		"expires_in", time.Until(c.session.ExpiresAt).Round(time.Second),
	)

	return nil
}

// Run starts the read/write loops and handles reconnection
func (c *Client) Run(ctx context.Context) error {
	for {
		select {
		case <-ctx.Done():
			c.Close()
			return ctx.Err()
		default:
		}

		// Connect if not connected
		c.mu.RLock()
		connected := c.connected
		c.mu.RUnlock()

		if !connected {
			if err := c.Connect(ctx); err != nil {
				c.handleReconnect(ctx)
				continue
			}
		}

		// Start read/write loops
		errCh := make(chan error, 2)

		go func() {
			errCh <- c.readLoop(ctx)
		}()

		go func() {
			errCh <- c.writeLoop(ctx)
		}()

		// Wait for error
		err := <-errCh
		c.log.Warn("Connection loop ended", "error", err)

		// Mark as disconnected
		c.mu.Lock()
		c.connected = false
		c.mu.Unlock()

		// Close connection
		if c.conn != nil {
			c.conn.Close()
		}

		// Check if context is cancelled
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
			c.handleReconnect(ctx)
		}
	}
}

// readLoop reads messages from the WebSocket
func (c *Client) readLoop(ctx context.Context) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		_, msg, err := c.conn.ReadMessage()
		if err != nil {
			return fmt.Errorf("read error: %w", err)
		}

		// Parse message type
		var base protocol.Message
		if err := json.Unmarshal(msg, &base); err != nil {
			c.log.Warn("Failed to parse message", "error", err)
			continue
		}

		// Handle heartbeat ack internally
		if base.Type == protocol.TypeHeartbeatAck {
			c.log.Debug("Received heartbeat ack")
			continue
		}

		// Pass to handler
		if c.handler != nil {
			c.handler(base.Type, msg)
		}
	}
}

// writeLoop writes messages from the send channel
func (c *Client) writeLoop(ctx context.Context) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case msg := <-c.sendCh:
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return fmt.Errorf("write error: %w", err)
			}
		}
	}
}

// handleReconnect implements exponential backoff reconnection
func (c *Client) handleReconnect(ctx context.Context) {
	c.mu.Lock()
	c.reconnecting = true
	c.reconnectCount++
	count := c.reconnectCount
	c.mu.Unlock()

	// Calculate backoff duration
	backoff := c.cfg.ReconnectInterval * time.Duration(1<<uint(count-1))
	if backoff > c.cfg.MaxReconnectInterval {
		backoff = c.cfg.MaxReconnectInterval
	}

	c.log.Info("Reconnecting",
		"attempt", count,
		"backoff", backoff,
	)

	select {
	case <-ctx.Done():
		return
	case <-time.After(backoff):
		return
	}
}

// Send queues a message for sending
func (c *Client) Send(msg interface{}) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("failed to marshal message: %w", err)
	}

	select {
	case c.sendCh <- data:
		return nil
	default:
		return fmt.Errorf("send channel full")
	}
}

// SendHeartbeat sends a heartbeat message
func (c *Client) SendHeartbeat(metrics protocol.HeartbeatMetrics) error {
	msg := protocol.HeartbeatMessage{
		Message: protocol.NewMessage(protocol.TypeHeartbeat, auth.GenerateNonce()),
		Metrics: metrics,
	}
	return c.Send(msg)
}

// SendCommandResult sends a command result
func (c *Client) SendCommandResult(commandID string, success bool, data interface{}, errMsg string, duration time.Duration) error {
	var dataBytes json.RawMessage
	if data != nil {
		var err error
		dataBytes, err = json.Marshal(data)
		if err != nil {
			return fmt.Errorf("failed to marshal data: %w", err)
		}
	}

	msg := protocol.CommandResult{
		Message:   protocol.NewMessage(protocol.TypeCommandResult, auth.GenerateNonce()),
		CommandID: commandID,
		Success:   success,
		Data:      dataBytes,
		Error:     errMsg,
		Duration:  duration.Milliseconds(),
	}
	return c.Send(msg)
}

// SendStream sends streaming data
func (c *Client) SendStream(channel string, data interface{}) error {
	dataBytes, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("failed to marshal data: %w", err)
	}

	msg := protocol.StreamMessage{
		Message: protocol.NewMessage(protocol.TypeStream, auth.GenerateNonce()),
		Channel: channel,
		Data:    dataBytes,
	}
	return c.Send(msg)
}

// SendError sends an error message
func (c *Client) SendError(code, details string) error {
	msg := protocol.ErrorMessage{
		Message: protocol.NewMessage(protocol.TypeError, auth.GenerateNonce()),
		Code:    code,
		Details: details,
	}
	return c.Send(msg)
}

// IsConnected returns the connection status
func (c *Client) IsConnected() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.connected
}

// Close closes the WebSocket connection
func (c *Client) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.conn != nil {
		// Send close message
		c.conn.WriteMessage(
			websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""),
		)
		c.conn.Close()
		c.conn = nil
	}

	c.connected = false
	return nil
}

// Session returns the current session token
func (c *Client) Session() *auth.SessionToken {
	return c.session
}
