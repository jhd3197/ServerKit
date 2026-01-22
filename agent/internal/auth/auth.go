package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"
)

// Authenticator handles HMAC-based authentication
type Authenticator struct {
	agentID   string
	apiKey    string
	apiSecret string
}

// New creates a new Authenticator
func New(agentID, apiKey, apiSecret string) *Authenticator {
	return &Authenticator{
		agentID:   agentID,
		apiKey:    apiKey,
		apiSecret: apiSecret,
	}
}

// SignMessage creates an HMAC signature for authentication
// The signature is computed as: HMAC-SHA256(agent_id + timestamp, api_secret)
func (a *Authenticator) SignMessage(timestamp int64) string {
	message := fmt.Sprintf("%s:%d", a.agentID, timestamp)
	return a.computeHMAC(message)
}

// SignCommand creates an HMAC signature for a command
// Used to verify commands weren't tampered with
func (a *Authenticator) SignCommand(commandID string, action string, timestamp int64) string {
	message := fmt.Sprintf("%s:%s:%d", commandID, action, timestamp)
	return a.computeHMAC(message)
}

// VerifySignature verifies an HMAC signature
func (a *Authenticator) VerifySignature(message, signature string) bool {
	expected := a.computeHMAC(message)
	return hmac.Equal([]byte(expected), []byte(signature))
}

// VerifyTimestamp checks if a timestamp is within acceptable range
// Prevents replay attacks
func (a *Authenticator) VerifyTimestamp(timestamp int64, maxAgeSeconds int64) bool {
	now := time.Now().UnixMilli()
	diff := now - timestamp
	if diff < 0 {
		diff = -diff
	}
	return diff <= maxAgeSeconds*1000
}

// GetAPIKeyPrefix returns the first 8 characters of the API key
// Used for identification without exposing full key
func (a *Authenticator) GetAPIKeyPrefix() string {
	if len(a.apiKey) < 8 {
		return a.apiKey
	}
	return a.apiKey[:8]
}

// AgentID returns the agent ID
func (a *Authenticator) AgentID() string {
	return a.agentID
}

func (a *Authenticator) computeHMAC(message string) string {
	h := hmac.New(sha256.New, []byte(a.apiSecret))
	h.Write([]byte(message))
	return hex.EncodeToString(h.Sum(nil))
}

// GenerateNonce generates a random nonce for request uniqueness
func GenerateNonce() string {
	return fmt.Sprintf("%d-%d", time.Now().UnixNano(), time.Now().UnixMilli())
}

// SessionToken represents an authenticated session
type SessionToken struct {
	Token     string
	ExpiresAt time.Time
}

// IsExpired checks if the session token has expired
func (s *SessionToken) IsExpired() bool {
	return time.Now().After(s.ExpiresAt)
}

// IsExpiringSoon checks if the token expires within the given duration
func (s *SessionToken) IsExpiringSoon(within time.Duration) bool {
	return time.Now().Add(within).After(s.ExpiresAt)
}
