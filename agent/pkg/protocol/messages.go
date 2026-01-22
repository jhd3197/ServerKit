package protocol

import (
	"encoding/json"
	"time"
)

// MessageType defines the type of message
type MessageType string

const (
	// Authentication
	TypeAuth       MessageType = "auth"
	TypeAuthOK     MessageType = "auth_ok"
	TypeAuthFail   MessageType = "auth_fail"

	// Heartbeat
	TypeHeartbeat    MessageType = "heartbeat"
	TypeHeartbeatAck MessageType = "heartbeat_ack"

	// Commands
	TypeCommand       MessageType = "command"
	TypeCommandResult MessageType = "command_result"

	// Streaming
	TypeSubscribe   MessageType = "subscribe"
	TypeUnsubscribe MessageType = "unsubscribe"
	TypeStream      MessageType = "stream"

	// Errors
	TypeError MessageType = "error"

	// System
	TypeSystemInfo MessageType = "system_info"
)

// Message is the base message structure
type Message struct {
	Type      MessageType `json:"type"`
	ID        string      `json:"id"`
	Timestamp int64       `json:"timestamp"`
	Signature string      `json:"signature,omitempty"`
}

// NewMessage creates a new message with timestamp
func NewMessage(msgType MessageType, id string) Message {
	return Message{
		Type:      msgType,
		ID:        id,
		Timestamp: time.Now().UnixMilli(),
	}
}

// AuthMessage is sent by agent to authenticate
type AuthMessage struct {
	Message
	AgentID      string `json:"agent_id"`
	APIKeyPrefix string `json:"api_key_prefix"`
}

// AuthResponse is sent by server after authentication
type AuthResponse struct {
	Message
	SessionToken string `json:"session_token,omitempty"`
	Expires      int64  `json:"expires,omitempty"`
	Error        string `json:"error,omitempty"`
}

// HeartbeatMessage is sent periodically by agent
type HeartbeatMessage struct {
	Message
	Metrics HeartbeatMetrics `json:"metrics"`
}

// HeartbeatMetrics contains basic system metrics
type HeartbeatMetrics struct {
	CPUPercent       float64 `json:"cpu_percent"`
	MemoryPercent    float64 `json:"memory_percent"`
	DiskPercent      float64 `json:"disk_percent"`
	ContainerCount   int     `json:"container_count"`
	ContainerRunning int     `json:"container_running"`
}

// HeartbeatAck is sent by server to acknowledge heartbeat
type HeartbeatAck struct {
	Message
}

// CommandMessage is sent by server to execute a command
type CommandMessage struct {
	Message
	Action  string          `json:"action"`
	Params  json.RawMessage `json:"params"`
	Timeout int             `json:"timeout,omitempty"` // milliseconds
}

// CommandResult is sent by agent after executing a command
type CommandResult struct {
	Message
	CommandID string          `json:"command_id"`
	Success   bool            `json:"success"`
	Data      json.RawMessage `json:"data,omitempty"`
	Error     string          `json:"error,omitempty"`
	Duration  int64           `json:"duration"` // milliseconds
}

// SubscribeMessage requests subscription to a data stream
type SubscribeMessage struct {
	Message
	Channel string `json:"channel"`
}

// UnsubscribeMessage cancels a subscription
type UnsubscribeMessage struct {
	Message
	Channel string `json:"channel"`
}

// StreamMessage contains streaming data
type StreamMessage struct {
	Message
	Channel string          `json:"channel"`
	Data    json.RawMessage `json:"data"`
}

// ErrorMessage represents an error
type ErrorMessage struct {
	Message
	Code    string `json:"code"`
	Details string `json:"details,omitempty"`
}

// SystemInfoMessage contains system information
type SystemInfoMessage struct {
	Message
	Info SystemInfo `json:"info"`
}

// SystemInfo contains detailed system information
type SystemInfo struct {
	Hostname     string `json:"hostname"`
	OS           string `json:"os"`
	OSVersion    string `json:"os_version"`
	Architecture string `json:"architecture"`
	CPUCores     int    `json:"cpu_cores"`
	TotalMemory  uint64 `json:"total_memory"`
	TotalDisk    uint64 `json:"total_disk"`
	DockerVersion string `json:"docker_version,omitempty"`
	AgentVersion string `json:"agent_version"`
}

// Command actions
const (
	// Docker container actions
	ActionDockerContainerList    = "docker:container:list"
	ActionDockerContainerInspect = "docker:container:inspect"
	ActionDockerContainerCreate  = "docker:container:create"
	ActionDockerContainerStart   = "docker:container:start"
	ActionDockerContainerStop    = "docker:container:stop"
	ActionDockerContainerRestart = "docker:container:restart"
	ActionDockerContainerRemove  = "docker:container:remove"
	ActionDockerContainerLogs    = "docker:container:logs"
	ActionDockerContainerStats   = "docker:container:stats"
	ActionDockerContainerExec    = "docker:container:exec"

	// Docker image actions
	ActionDockerImageList   = "docker:image:list"
	ActionDockerImagePull   = "docker:image:pull"
	ActionDockerImageRemove = "docker:image:remove"
	ActionDockerImageBuild  = "docker:image:build"

	// Docker volume actions
	ActionDockerVolumeList   = "docker:volume:list"
	ActionDockerVolumeCreate = "docker:volume:create"
	ActionDockerVolumeRemove = "docker:volume:remove"

	// Docker network actions
	ActionDockerNetworkList   = "docker:network:list"
	ActionDockerNetworkCreate = "docker:network:create"
	ActionDockerNetworkRemove = "docker:network:remove"

	// Docker compose actions
	ActionDockerComposeList = "docker:compose:list"
	ActionDockerComposeUp   = "docker:compose:up"
	ActionDockerComposeDown = "docker:compose:down"

	// System actions
	ActionSystemMetrics   = "system:metrics"
	ActionSystemInfo      = "system:info"
	ActionSystemProcesses = "system:processes"
	ActionSystemExec      = "system:exec"

	// File actions
	ActionFileRead  = "file:read"
	ActionFileWrite = "file:write"
	ActionFileList  = "file:list"
)

// Stream channels
const (
	ChannelMetrics       = "metrics"
	ChannelContainerLogs = "container:%s:logs"
	ChannelContainerStats = "container:%s:stats"
)
