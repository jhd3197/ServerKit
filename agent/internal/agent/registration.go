package agent

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"runtime"
	"strings"
	"time"

	"github.com/serverkit/agent/internal/config"
	"github.com/serverkit/agent/internal/logger"
	"github.com/serverkit/agent/internal/metrics"
)

// Registration handles agent registration with ServerKit
type Registration struct {
	log *logger.Logger
}

// RegistrationResult contains the result of registration
type RegistrationResult struct {
	AgentID      string `json:"agent_id"`
	Name         string `json:"name"`
	APIKey       string `json:"api_key"`
	APISecret    string `json:"api_secret"`
	WebSocketURL string `json:"websocket_url"`
}

// NewRegistration creates a new Registration handler
func NewRegistration(log *logger.Logger) *Registration {
	return &Registration{
		log: log.WithComponent("registration"),
	}
}

// Register registers the agent with a ServerKit instance
func (r *Registration) Register(serverURL, token, name string) (*RegistrationResult, error) {
	// Normalize server URL
	serverURL = strings.TrimSuffix(serverURL, "/")

	// If no name provided, use hostname
	if name == "" {
		hostname, err := os.Hostname()
		if err != nil {
			name = "unknown-server"
		} else {
			name = hostname
		}
	}

	// Collect system info for registration
	collector := metrics.NewCollector(config.MetricsConfig{}, r.log)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	sysInfo, err := collector.GetSystemInfo(ctx)
	if err != nil {
		r.log.Warn("Failed to collect system info", "error", err)
		sysInfo = &metrics.SystemInfo{
			Hostname:     name,
			OS:           runtime.GOOS,
			Architecture: runtime.GOARCH,
		}
	}

	// Prepare registration request
	reqBody := map[string]interface{}{
		"token": token,
		"name":  name,
		"system_info": map[string]interface{}{
			"hostname":         sysInfo.Hostname,
			"os":               sysInfo.OS,
			"platform":         sysInfo.Platform,
			"platform_version": sysInfo.PlatformVersion,
			"architecture":     sysInfo.Architecture,
			"cpu_cores":        sysInfo.CPUCores,
			"total_memory":     sysInfo.TotalMemory,
			"total_disk":       sysInfo.TotalDisk,
		},
		"agent_version": Version,
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	// Create HTTP client
	client := &http.Client{
		Timeout: 30 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{
				// Allow insecure for development - in production this should be strict
				InsecureSkipVerify: strings.HasPrefix(serverURL, "http://") || strings.Contains(serverURL, "localhost"),
			},
		},
	}

	// Make registration request
	registrationURL := serverURL + "/api/v1/agents/register"
	r.log.Info("Sending registration request", "url", registrationURL)

	req, err := http.NewRequestWithContext(ctx, "POST", registrationURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", fmt.Sprintf("ServerKit-Agent/%s", Version))

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("registration request failed: %w", err)
	}
	defer resp.Body.Close()

	// Read response
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	// Check status code
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		var errResp struct {
			Error string `json:"error"`
		}
		json.Unmarshal(respBody, &errResp)
		if errResp.Error != "" {
			return nil, fmt.Errorf("registration failed: %s", errResp.Error)
		}
		return nil, fmt.Errorf("registration failed with status %d", resp.StatusCode)
	}

	// Parse response
	var result RegistrationResult
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	// Construct WebSocket URL if not provided
	if result.WebSocketURL == "" {
		wsURL := serverURL
		wsURL = strings.Replace(wsURL, "https://", "wss://", 1)
		wsURL = strings.Replace(wsURL, "http://", "ws://", 1)
		result.WebSocketURL = wsURL + "/agent/ws"
	}

	r.log.Info("Registration successful",
		"agent_id", result.AgentID,
		"name", result.Name,
	)

	return &result, nil
}

// Unregister unregisters the agent from ServerKit
func (r *Registration) Unregister(serverURL, agentID, apiKey, apiSecret string) error {
	serverURL = strings.TrimSuffix(serverURL, "/")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	req, err := http.NewRequestWithContext(ctx, "DELETE", serverURL+"/api/v1/agents/"+agentID, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("X-API-Key", apiKey)
	req.Header.Set("X-API-Secret", apiSecret)

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("unregister request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		return fmt.Errorf("unregister failed with status %d", resp.StatusCode)
	}

	return nil
}

// Version is set during build
var Version = "dev"
