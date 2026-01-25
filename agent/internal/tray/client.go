package tray

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/serverkit/agent/internal/ipc"
)

// Client communicates with the agent's IPC server
type Client struct {
	baseURL    string
	httpClient *http.Client
}

// NewClient creates a new IPC client
func NewClient(address string, port int) *Client {
	return &Client{
		baseURL: fmt.Sprintf("http://%s:%d", address, port),
		httpClient: &http.Client{
			Timeout: 5 * time.Second,
		},
	}
}

// GetStatus fetches the agent status
func (c *Client) GetStatus() (*ipc.AgentStatus, error) {
	resp, err := c.httpClient.Get(c.baseURL + "/status")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	var status ipc.AgentStatus
	if err := json.NewDecoder(resp.Body).Decode(&status); err != nil {
		return nil, err
	}

	return &status, nil
}

// GetMetrics fetches detailed system metrics
func (c *Client) GetMetrics() (*ipc.DetailedMetrics, error) {
	resp, err := c.httpClient.Get(c.baseURL + "/metrics")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	var metrics ipc.DetailedMetrics
	if err := json.NewDecoder(resp.Body).Decode(&metrics); err != nil {
		return nil, err
	}

	return &metrics, nil
}

// GetConnection fetches WebSocket connection info
func (c *Client) GetConnection() (*ipc.ConnectionInfo, error) {
	resp, err := c.httpClient.Get(c.baseURL + "/connection")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	var info ipc.ConnectionInfo
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return nil, err
	}

	return &info, nil
}

// GetLogs fetches recent log lines
func (c *Client) GetLogs(lines int) ([]string, error) {
	resp, err := c.httpClient.Get(fmt.Sprintf("%s/logs?lines=%d", c.baseURL, lines))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	var result struct {
		Lines []string `json:"lines"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	return result.Lines, nil
}

// Restart requests agent restart
func (c *Client) Restart() error {
	resp, err := c.httpClient.Post(c.baseURL+"/restart", "application/json", nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	var result struct {
		Success bool   `json:"success"`
		Error   string `json:"error,omitempty"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return err
	}

	if !result.Success {
		return fmt.Errorf("restart failed: %s", result.Error)
	}

	return nil
}

// IsAgentRunning checks if the agent is reachable
func (c *Client) IsAgentRunning() bool {
	resp, err := c.httpClient.Get(c.baseURL + "/health")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}
