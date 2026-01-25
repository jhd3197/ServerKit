package agent

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/serverkit/agent/internal/auth"
	"github.com/serverkit/agent/internal/config"
	"github.com/serverkit/agent/internal/docker"
	"github.com/serverkit/agent/internal/ipc"
	"github.com/serverkit/agent/internal/logger"
	"github.com/serverkit/agent/internal/metrics"
	"github.com/serverkit/agent/internal/terminal"
	"github.com/serverkit/agent/internal/ws"
	"github.com/serverkit/agent/pkg/protocol"
)

// Agent is the main agent that coordinates all components
type Agent struct {
	cfg      *config.Config
	log      *logger.Logger
	auth     *auth.Authenticator
	ws       *ws.Client
	docker   *docker.Client
	metrics  *metrics.Collector
	terminal *terminal.Manager
	ipc      *ipc.Server

	// Active subscriptions
	subscriptions map[string]context.CancelFunc
	subMu         sync.Mutex

	// Command handlers
	handlers map[string]CommandHandler

	// Lifecycle tracking
	startTime      time.Time
	restartCh      chan struct{}
	lastConnected  time.Time
	reconnectCount int
}

// CommandHandler is a function that handles a command
type CommandHandler func(ctx context.Context, params json.RawMessage) (interface{}, error)

// New creates a new Agent
func New(cfg *config.Config, log *logger.Logger) (*Agent, error) {
	// Create authenticator
	authenticator := auth.New(cfg.Agent.ID, cfg.Auth.APIKey, cfg.Auth.APISecret)

	// Create WebSocket client
	wsClient := ws.NewClient(cfg.Server, authenticator, log)

	// Create Docker client if enabled
	var dockerClient *docker.Client
	if cfg.Features.Docker {
		var err error
		dockerClient, err = docker.NewClient(cfg.Docker, log)
		if err != nil {
			log.Warn("Failed to create Docker client", "error", err)
			// Don't fail - Docker may not be available
		}
	}

	// Create metrics collector if enabled
	var metricsCollector *metrics.Collector
	if cfg.Features.Metrics {
		metricsCollector = metrics.NewCollector(cfg.Metrics, log)
	}

	// Create terminal manager if exec is enabled
	var termManager *terminal.Manager
	if cfg.Features.Exec {
		termManager = terminal.NewManager()
		log.Info("Terminal/PTY support enabled")
	}

	agent := &Agent{
		cfg:           cfg,
		log:           log,
		auth:          authenticator,
		ws:            wsClient,
		docker:        dockerClient,
		metrics:       metricsCollector,
		terminal:      termManager,
		subscriptions: make(map[string]context.CancelFunc),
		handlers:      make(map[string]CommandHandler),
		startTime:     time.Now(),
		restartCh:     make(chan struct{}),
	}

	// Register command handlers
	agent.registerHandlers()

	// Set WebSocket message handler
	wsClient.SetHandler(agent.handleMessage)

	// Create IPC server if enabled
	if cfg.IPC.Enabled {
		agent.ipc = ipc.NewServer(cfg.IPC, log, agent)
	}

	return agent, nil
}

// registerHandlers registers all command handlers
func (a *Agent) registerHandlers() {
	// Docker container commands
	if a.docker != nil {
		a.handlers[protocol.ActionDockerContainerList] = a.handleDockerContainerList
		a.handlers[protocol.ActionDockerContainerInspect] = a.handleDockerContainerInspect
		a.handlers[protocol.ActionDockerContainerStart] = a.handleDockerContainerStart
		a.handlers[protocol.ActionDockerContainerStop] = a.handleDockerContainerStop
		a.handlers[protocol.ActionDockerContainerRestart] = a.handleDockerContainerRestart
		a.handlers[protocol.ActionDockerContainerRemove] = a.handleDockerContainerRemove
		a.handlers[protocol.ActionDockerContainerStats] = a.handleDockerContainerStats
		a.handlers[protocol.ActionDockerContainerLogs] = a.handleDockerContainerLogs

		// Docker image commands
		a.handlers[protocol.ActionDockerImageList] = a.handleDockerImageList
		a.handlers[protocol.ActionDockerImagePull] = a.handleDockerImagePull
		a.handlers[protocol.ActionDockerImageRemove] = a.handleDockerImageRemove

		// Docker volume commands
		a.handlers[protocol.ActionDockerVolumeList] = a.handleDockerVolumeList
		a.handlers[protocol.ActionDockerVolumeRemove] = a.handleDockerVolumeRemove

		// Docker network commands
		a.handlers[protocol.ActionDockerNetworkList] = a.handleDockerNetworkList

		// Docker compose commands
		a.handlers[protocol.ActionDockerComposeList] = a.handleDockerComposeList
		a.handlers[protocol.ActionDockerComposePs] = a.handleDockerComposePs
		a.handlers[protocol.ActionDockerComposeUp] = a.handleDockerComposeUp
		a.handlers[protocol.ActionDockerComposeDown] = a.handleDockerComposeDown
		a.handlers[protocol.ActionDockerComposeLogs] = a.handleDockerComposeLogs
		a.handlers[protocol.ActionDockerComposeRestart] = a.handleDockerComposeRestart
		a.handlers[protocol.ActionDockerComposePull] = a.handleDockerComposePull
	}

	// System commands
	if a.metrics != nil {
		a.handlers[protocol.ActionSystemMetrics] = a.handleSystemMetrics
		a.handlers[protocol.ActionSystemInfo] = a.handleSystemInfo
		a.handlers[protocol.ActionSystemProcesses] = a.handleSystemProcesses
	}

	// Terminal commands
	if a.terminal != nil {
		a.handlers[protocol.ActionTerminalCreate] = a.handleTerminalCreate
		a.handlers[protocol.ActionTerminalInput] = a.handleTerminalInput
		a.handlers[protocol.ActionTerminalResize] = a.handleTerminalResize
		a.handlers[protocol.ActionTerminalClose] = a.handleTerminalClose
	}
}

// Run starts the agent
func (a *Agent) Run(ctx context.Context) error {
	a.log.Info("Starting agent",
		"agent_id", a.cfg.Agent.ID,
		"version", Version,
		"features", fmt.Sprintf("docker=%v metrics=%v ipc=%v", a.cfg.Features.Docker, a.cfg.Features.Metrics, a.cfg.IPC.Enabled),
	)

	// Verify Docker connection if enabled
	if a.docker != nil {
		if err := a.docker.Ping(ctx); err != nil {
			a.log.Warn("Docker is not available", "error", err)
		} else {
			version, _ := a.docker.Version(ctx)
			a.log.Info("Docker connected", "version", version)
		}
	}

	// Start IPC server if enabled
	if a.ipc != nil {
		if err := a.ipc.Start(ctx); err != nil {
			a.log.Warn("Failed to start IPC server", "error", err)
		}
	}

	// Start WebSocket connection in background
	go func() {
		if err := a.ws.Run(ctx); err != nil && err != context.Canceled {
			a.log.Error("WebSocket error", "error", err)
		}
	}()

	// Start heartbeat loop
	go a.heartbeatLoop(ctx)

	// Wait for context cancellation or restart request
	select {
	case <-ctx.Done():
	case <-a.restartCh:
		a.log.Info("Restart requested")
	}

	// Cleanup
	a.cleanup()

	return ctx.Err()
}

// heartbeatLoop sends periodic heartbeats
func (a *Agent) heartbeatLoop(ctx context.Context) {
	ticker := time.NewTicker(a.cfg.Server.PingInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if !a.ws.IsConnected() {
				continue
			}

			heartbeatMetrics := protocol.HeartbeatMetrics{}

			// Collect basic metrics for heartbeat
			if a.metrics != nil {
				sysMetrics, err := a.metrics.Collect(ctx)
				if err == nil {
					heartbeatMetrics.CPUPercent = sysMetrics.CPUPercent
					heartbeatMetrics.MemoryPercent = sysMetrics.MemoryPercent
					heartbeatMetrics.DiskPercent = sysMetrics.DiskPercent
				}
			}

			// Get container counts if Docker is available
			if a.docker != nil {
				total, running, err := a.docker.GetContainerCount(ctx)
				if err == nil {
					heartbeatMetrics.ContainerCount = total
					heartbeatMetrics.ContainerRunning = running
				}
			}

			if err := a.ws.SendHeartbeat(heartbeatMetrics); err != nil {
				a.log.Warn("Failed to send heartbeat", "error", err)
			} else {
				a.log.Debug("Heartbeat sent",
					"cpu", fmt.Sprintf("%.1f%%", heartbeatMetrics.CPUPercent),
					"mem", fmt.Sprintf("%.1f%%", heartbeatMetrics.MemoryPercent),
				)
			}
		}
	}
}

// handleMessage handles incoming WebSocket messages
func (a *Agent) handleMessage(msgType protocol.MessageType, data []byte) {
	a.log.Debug("Received message", "type", msgType)

	switch msgType {
	case protocol.TypeCommand:
		a.handleCommand(data)
	case protocol.TypeSubscribe:
		a.handleSubscribe(data)
	case protocol.TypeUnsubscribe:
		a.handleUnsubscribe(data)
	case protocol.TypeCredentialUpdate:
		a.handleCredentialUpdate(data)
	default:
		a.log.Warn("Unknown message type", "type", msgType)
	}
}

// handleCommand handles command messages
func (a *Agent) handleCommand(data []byte) {
	var cmd protocol.CommandMessage
	if err := json.Unmarshal(data, &cmd); err != nil {
		a.log.Error("Failed to parse command", "error", err)
		return
	}

	a.log.Info("Executing command",
		"id", cmd.ID,
		"action", cmd.Action,
	)

	// Find handler
	handler, ok := a.handlers[cmd.Action]
	if !ok {
		a.log.Warn("Unknown command action", "action", cmd.Action)
		a.ws.SendCommandResult(cmd.ID, false, nil, "unknown action: "+cmd.Action, 0)
		return
	}

	// Execute command
	start := time.Now()
	ctx := context.Background()
	if cmd.Timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, time.Duration(cmd.Timeout)*time.Millisecond)
		defer cancel()
	}

	result, err := handler(ctx, cmd.Params)
	duration := time.Since(start)

	if err != nil {
		a.log.Error("Command failed",
			"id", cmd.ID,
			"action", cmd.Action,
			"error", err,
			"duration", duration,
		)
		a.ws.SendCommandResult(cmd.ID, false, nil, err.Error(), duration)
		return
	}

	a.log.Info("Command completed",
		"id", cmd.ID,
		"action", cmd.Action,
		"duration", duration,
	)
	a.ws.SendCommandResult(cmd.ID, true, result, "", duration)
}

// handleSubscribe handles subscription requests
func (a *Agent) handleSubscribe(data []byte) {
	var sub protocol.SubscribeMessage
	if err := json.Unmarshal(data, &sub); err != nil {
		a.log.Error("Failed to parse subscribe message", "error", err)
		return
	}

	a.log.Info("Subscribing to channel", "channel", sub.Channel)

	// Create cancellable context for this subscription
	ctx, cancel := context.WithCancel(context.Background())

	a.subMu.Lock()
	// Cancel existing subscription if any
	if existingCancel, ok := a.subscriptions[sub.Channel]; ok {
		existingCancel()
	}
	a.subscriptions[sub.Channel] = cancel
	a.subMu.Unlock()

	// Start streaming based on channel type
	go a.streamData(ctx, sub.Channel)
}

// handleUnsubscribe handles unsubscription requests
func (a *Agent) handleUnsubscribe(data []byte) {
	var unsub protocol.UnsubscribeMessage
	if err := json.Unmarshal(data, &unsub); err != nil {
		a.log.Error("Failed to parse unsubscribe message", "error", err)
		return
	}

	a.log.Info("Unsubscribing from channel", "channel", unsub.Channel)

	a.subMu.Lock()
	if cancel, ok := a.subscriptions[unsub.Channel]; ok {
		cancel()
		delete(a.subscriptions, unsub.Channel)
	}
	a.subMu.Unlock()
}

// streamData streams data for a subscription
func (a *Agent) streamData(ctx context.Context, channel string) {
	// Determine what to stream based on channel
	switch channel {
	case protocol.ChannelMetrics:
		a.streamMetrics(ctx, channel)
	default:
		a.log.Warn("Unknown stream channel", "channel", channel)
	}
}

// streamMetrics streams system metrics
func (a *Agent) streamMetrics(ctx context.Context, channel string) {
	ticker := time.NewTicker(a.cfg.Metrics.Interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if a.metrics == nil {
				continue
			}

			sysMetrics, err := a.metrics.Collect(ctx)
			if err != nil {
				a.log.Warn("Failed to collect metrics", "error", err)
				continue
			}

			if err := a.ws.SendStream(channel, sysMetrics); err != nil {
				a.log.Warn("Failed to send metrics stream", "error", err)
			}
		}
	}
}

// cleanup performs cleanup on shutdown
// handleCredentialUpdate handles credential rotation from server
func (a *Agent) handleCredentialUpdate(data []byte) {
	var msg protocol.CredentialUpdateMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		a.log.Error("Failed to parse credential update", "error", err)
		return
	}

	a.log.Info("Received credential update request", "rotation_id", msg.RotationID)

	// Update authenticator with new credentials
	a.auth.UpdateCredentials(msg.APIKey, msg.APISecret)

	// Save new credentials to config file
	err := a.saveCredentials(msg.APIKey, msg.APISecret)

	// Send acknowledgment
	ack := protocol.CredentialUpdateAck{
		Message:    protocol.NewMessage(protocol.TypeCredentialUpdateAck, auth.GenerateNonce()),
		RotationID: msg.RotationID,
		Success:    err == nil,
	}
	if err != nil {
		ack.Error = err.Error()
		a.log.Error("Failed to save new credentials", "error", err)
	} else {
		a.log.Info("Credentials updated successfully", "rotation_id", msg.RotationID)
	}

	a.ws.Send(ack)
}

// saveCredentials saves new credentials to the key file
func (a *Agent) saveCredentials(apiKey, apiSecret string) error {
	// Update config with new credentials
	a.cfg.Auth.APIKey = apiKey
	a.cfg.Auth.APISecret = apiSecret

	// Save using existing secure method
	return a.cfg.SaveCredentials()
}

func (a *Agent) cleanup() {
	a.log.Info("Cleaning up...")

	// Cancel all subscriptions
	a.subMu.Lock()
	for _, cancel := range a.subscriptions {
		cancel()
	}
	a.subscriptions = make(map[string]context.CancelFunc)
	a.subMu.Unlock()

	// Close all terminal sessions
	if a.terminal != nil {
		a.terminal.CloseAll()
	}

	// Stop IPC server
	if a.ipc != nil {
		a.ipc.Stop()
	}

	// Close WebSocket
	a.ws.Close()

	// Close Docker client
	if a.docker != nil {
		a.docker.Close()
	}
}

// Docker command handlers

func (a *Agent) handleDockerContainerList(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var p struct {
		All bool `json:"all"`
	}
	if len(params) > 0 {
		json.Unmarshal(params, &p)
	}
	return a.docker.ListContainers(ctx, p.All)
}

func (a *Agent) handleDockerContainerInspect(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var p struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}
	return a.docker.InspectContainer(ctx, p.ID)
}

func (a *Agent) handleDockerContainerStart(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var p struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}
	return map[string]bool{"success": true}, a.docker.StartContainer(ctx, p.ID)
}

func (a *Agent) handleDockerContainerStop(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var p struct {
		ID      string `json:"id"`
		Timeout *int   `json:"timeout"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}
	return map[string]bool{"success": true}, a.docker.StopContainer(ctx, p.ID, p.Timeout)
}

func (a *Agent) handleDockerContainerRestart(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var p struct {
		ID      string `json:"id"`
		Timeout *int   `json:"timeout"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}
	return map[string]bool{"success": true}, a.docker.RestartContainer(ctx, p.ID, p.Timeout)
}

func (a *Agent) handleDockerContainerRemove(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var p struct {
		ID            string `json:"id"`
		Force         bool   `json:"force"`
		RemoveVolumes bool   `json:"remove_volumes"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}
	return map[string]bool{"success": true}, a.docker.RemoveContainer(ctx, p.ID, p.Force, p.RemoveVolumes)
}

func (a *Agent) handleDockerContainerStats(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var p struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}
	return a.docker.ContainerStats(ctx, p.ID)
}

func (a *Agent) handleDockerContainerLogs(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var p struct {
		ID         string `json:"id"`
		Tail       string `json:"tail"`
		Since      string `json:"since"`
		Timestamps bool   `json:"timestamps"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}

	// Set defaults
	if p.Tail == "" {
		p.Tail = "100"
	}

	reader, err := a.docker.ContainerLogs(ctx, p.ID, p.Tail, p.Since, false)
	if err != nil {
		return nil, err
	}
	defer reader.Close()

	// Read logs into buffer
	buf := make([]byte, 1024*1024) // 1MB max
	n, _ := reader.Read(buf)
	logs := string(buf[:n])

	return map[string]interface{}{
		"logs": logs,
	}, nil
}

func (a *Agent) handleDockerImageList(ctx context.Context, params json.RawMessage) (interface{}, error) {
	return a.docker.ListImages(ctx)
}

func (a *Agent) handleDockerImagePull(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var p struct {
		Image string `json:"image"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}

	reader, err := a.docker.PullImage(ctx, p.Image)
	if err != nil {
		return nil, err
	}
	defer reader.Close()

	// Read the output to completion
	var output []map[string]interface{}
	decoder := json.NewDecoder(reader)
	for decoder.More() {
		var msg map[string]interface{}
		if err := decoder.Decode(&msg); err != nil {
			break
		}
		output = append(output, msg)
	}

	return map[string]interface{}{
		"success": true,
		"output":  output,
	}, nil
}

func (a *Agent) handleDockerImageRemove(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var p struct {
		ID    string `json:"id"`
		Force bool   `json:"force"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}
	return map[string]bool{"success": true}, a.docker.RemoveImage(ctx, p.ID, p.Force)
}

func (a *Agent) handleDockerVolumeList(ctx context.Context, params json.RawMessage) (interface{}, error) {
	return a.docker.ListVolumes(ctx)
}

func (a *Agent) handleDockerVolumeRemove(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var p struct {
		Name  string `json:"name"`
		Force bool   `json:"force"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}
	return map[string]bool{"success": true}, a.docker.RemoveVolume(ctx, p.Name, p.Force)
}

func (a *Agent) handleDockerNetworkList(ctx context.Context, params json.RawMessage) (interface{}, error) {
	return a.docker.ListNetworks(ctx)
}

// System command handlers

func (a *Agent) handleSystemMetrics(ctx context.Context, params json.RawMessage) (interface{}, error) {
	return a.metrics.Collect(ctx)
}

func (a *Agent) handleSystemInfo(ctx context.Context, params json.RawMessage) (interface{}, error) {
	return a.metrics.GetSystemInfo(ctx)
}

func (a *Agent) handleSystemProcesses(ctx context.Context, params json.RawMessage) (interface{}, error) {
	return a.metrics.ListProcesses(ctx)
}

// Docker Compose command handlers

func (a *Agent) handleDockerComposeList(ctx context.Context, params json.RawMessage) (interface{}, error) {
	return a.docker.ComposeList(ctx)
}

func (a *Agent) handleDockerComposePs(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var p struct {
		ProjectPath string `json:"project_path"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}
	return a.docker.ComposePsProject(ctx, p.ProjectPath)
}

func (a *Agent) handleDockerComposeUp(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var p struct {
		ProjectPath string `json:"project_path"`
		Detach      bool   `json:"detach"`
		Build       bool   `json:"build"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}

	// Default to detached mode
	if !p.Detach {
		p.Detach = true
	}

	output, err := a.docker.ComposeUp(ctx, p.ProjectPath, p.Detach, p.Build)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"output":  output,
			"error":   err.Error(),
		}, nil
	}

	return map[string]interface{}{
		"success": true,
		"output":  output,
	}, nil
}

func (a *Agent) handleDockerComposeDown(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var p struct {
		ProjectPath   string `json:"project_path"`
		Volumes       bool   `json:"volumes"`
		RemoveOrphans bool   `json:"remove_orphans"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}

	output, err := a.docker.ComposeDown(ctx, p.ProjectPath, p.Volumes, p.RemoveOrphans)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"output":  output,
			"error":   err.Error(),
		}, nil
	}

	return map[string]interface{}{
		"success": true,
		"output":  output,
	}, nil
}

func (a *Agent) handleDockerComposeLogs(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var p struct {
		ProjectPath string `json:"project_path"`
		Service     string `json:"service"`
		Tail        int    `json:"tail"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}

	// Default tail to 100
	if p.Tail == 0 {
		p.Tail = 100
	}

	logs, err := a.docker.ComposeLogs(ctx, p.ProjectPath, p.Service, p.Tail)
	if err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"logs": logs,
	}, nil
}

func (a *Agent) handleDockerComposeRestart(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var p struct {
		ProjectPath string `json:"project_path"`
		Service     string `json:"service"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}

	output, err := a.docker.ComposeRestart(ctx, p.ProjectPath, p.Service)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"output":  output,
			"error":   err.Error(),
		}, nil
	}

	return map[string]interface{}{
		"success": true,
		"output":  output,
	}, nil
}

func (a *Agent) handleDockerComposePull(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var p struct {
		ProjectPath string `json:"project_path"`
		Service     string `json:"service"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}

	output, err := a.docker.ComposePull(ctx, p.ProjectPath, p.Service)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"output":  output,
			"error":   err.Error(),
		}, nil
	}

	return map[string]interface{}{
		"success": true,
		"output":  output,
	}, nil
}

// Terminal command handlers

func (a *Agent) handleTerminalCreate(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var p struct {
		SessionID string `json:"session_id"`
		Cols      uint16 `json:"cols"`
		Rows      uint16 `json:"rows"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}

	if p.SessionID == "" {
		return nil, fmt.Errorf("session_id is required")
	}

	// Default terminal size
	if p.Cols == 0 {
		p.Cols = 80
	}
	if p.Rows == 0 {
		p.Rows = 24
	}

	// Create terminal session
	session, err := a.terminal.CreateSession(p.SessionID, p.Cols, p.Rows)
	if err != nil {
		return nil, fmt.Errorf("failed to create terminal session: %w", err)
	}

	// Set up output handler to stream data back
	channel := fmt.Sprintf(protocol.ChannelTerminal, p.SessionID)
	session.SetOutputHandler(func(data []byte) {
		// Encode as base64 for safe transport
		encoded := base64.StdEncoding.EncodeToString(data)
		if err := a.ws.SendStream(channel, map[string]interface{}{
			"type": "output",
			"data": encoded,
		}); err != nil {
			a.log.Warn("Failed to send terminal output", "error", err)
		}
	})

	// Set up close handler
	session.SetCloseHandler(func() {
		if err := a.ws.SendStream(channel, map[string]interface{}{
			"type": "closed",
		}); err != nil {
			a.log.Warn("Failed to send terminal close event", "error", err)
		}
		// Clean up session
		a.terminal.CloseSession(p.SessionID)
	})

	a.log.Info("Terminal session created",
		"session_id", p.SessionID,
		"cols", p.Cols,
		"rows", p.Rows,
		"shell", session.Shell,
	)

	return map[string]interface{}{
		"success":    true,
		"session_id": p.SessionID,
		"shell":      session.Shell,
		"cols":       session.Cols,
		"rows":       session.Rows,
	}, nil
}

func (a *Agent) handleTerminalInput(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var p struct {
		SessionID string `json:"session_id"`
		Data      string `json:"data"` // base64 encoded
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}

	session, ok := a.terminal.GetSession(p.SessionID)
	if !ok {
		return nil, fmt.Errorf("terminal session not found: %s", p.SessionID)
	}

	// Decode base64 data
	data, err := base64.StdEncoding.DecodeString(p.Data)
	if err != nil {
		return nil, fmt.Errorf("invalid base64 data: %w", err)
	}

	// Write to terminal
	_, err = session.Write(data)
	if err != nil {
		return nil, fmt.Errorf("failed to write to terminal: %w", err)
	}

	return map[string]interface{}{
		"success": true,
	}, nil
}

func (a *Agent) handleTerminalResize(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var p struct {
		SessionID string `json:"session_id"`
		Cols      uint16 `json:"cols"`
		Rows      uint16 `json:"rows"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}

	session, ok := a.terminal.GetSession(p.SessionID)
	if !ok {
		return nil, fmt.Errorf("terminal session not found: %s", p.SessionID)
	}

	if err := session.Resize(p.Cols, p.Rows); err != nil {
		return nil, fmt.Errorf("failed to resize terminal: %w", err)
	}

	a.log.Debug("Terminal resized",
		"session_id", p.SessionID,
		"cols", p.Cols,
		"rows", p.Rows,
	)

	return map[string]interface{}{
		"success": true,
		"cols":    p.Cols,
		"rows":    p.Rows,
	}, nil
}

func (a *Agent) handleTerminalClose(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var p struct {
		SessionID string `json:"session_id"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}

	if err := a.terminal.CloseSession(p.SessionID); err != nil {
		return nil, fmt.Errorf("failed to close terminal: %w", err)
	}

	a.log.Info("Terminal session closed", "session_id", p.SessionID)

	return map[string]interface{}{
		"success": true,
	}, nil
}

// IPC StatusProvider implementation

// GetStatus returns the current agent status for the IPC API
func (a *Agent) GetStatus() ipc.AgentStatus {
	status := ipc.AgentStatus{
		Running:    true,
		Connected:  a.ws.IsConnected(),
		Registered: a.cfg.Agent.ID != "",
		AgentID:    a.cfg.Agent.ID,
		AgentName:  a.cfg.Agent.Name,
		ServerURL:  a.cfg.Server.URL,
		Uptime:     int64(time.Since(a.startTime).Seconds()),
		Version:    Version,
	}

	// Collect current metrics if available
	if a.metrics != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if sysMetrics, err := a.metrics.Collect(ctx); err == nil {
			status.CPUPercent = sysMetrics.CPUPercent
			status.MemPercent = sysMetrics.MemoryPercent
			status.DiskPercent = sysMetrics.DiskPercent
		}
	}

	return status
}

// GetDetailedMetrics returns detailed system metrics for the IPC API
func (a *Agent) GetDetailedMetrics() *ipc.DetailedMetrics {
	if a.metrics == nil {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	sysMetrics, err := a.metrics.Collect(ctx)
	if err != nil {
		return nil
	}

	cores := 0
	if sysMetrics.CPUPerCore != nil {
		cores = len(sysMetrics.CPUPerCore)
	}

	return &ipc.DetailedMetrics{
		CPU: ipc.CPUMetrics{
			UsagePercent: sysMetrics.CPUPercent,
			PerCPU:       sysMetrics.CPUPerCore,
			Cores:        cores,
		},
		Memory: ipc.MemoryMetrics{
			Total:        sysMetrics.MemoryTotal,
			Used:         sysMetrics.MemoryUsed,
			Free:         sysMetrics.MemoryTotal - sysMetrics.MemoryUsed,
			UsagePercent: sysMetrics.MemoryPercent,
		},
		Disk: ipc.DiskMetrics{
			Total:        sysMetrics.DiskTotal,
			Used:         sysMetrics.DiskUsed,
			Free:         sysMetrics.DiskTotal - sysMetrics.DiskUsed,
			UsagePercent: sysMetrics.DiskPercent,
		},
		Network: ipc.NetworkMetrics{
			BytesSent:   sysMetrics.NetworkTx,
			BytesRecv:   sysMetrics.NetworkRx,
			PacketsSent: 0, // Not tracked in current implementation
			PacketsRecv: 0, // Not tracked in current implementation
		},
		Timestamp: time.Now().UnixMilli(),
	}
}

// GetConnectionInfo returns WebSocket connection information for the IPC API
func (a *Agent) GetConnectionInfo() ipc.ConnectionInfo {
	info := ipc.ConnectionInfo{
		Connected:      a.ws.IsConnected(),
		ServerURL:      a.cfg.Server.URL,
		ReconnectCount: a.reconnectCount,
	}

	if !a.lastConnected.IsZero() {
		info.LastConnected = a.lastConnected.UnixMilli()
	}

	if session := a.ws.Session(); session != nil {
		info.SessionExpires = session.ExpiresAt.UnixMilli()
	}

	return info
}

// GetRecentLogs returns recent log lines from the log file
func (a *Agent) GetRecentLogs(lines int) []string {
	logFile := a.cfg.Logging.File
	if logFile == "" {
		return []string{}
	}

	file, err := os.Open(logFile)
	if err != nil {
		return []string{}
	}
	defer file.Close()

	// Read all lines and keep the last N
	var allLines []string
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		allLines = append(allLines, scanner.Text())
	}

	// Return the last N lines
	if len(allLines) <= lines {
		return allLines
	}
	return allLines[len(allLines)-lines:]
}

// Restart initiates a graceful restart of the agent
func (a *Agent) Restart() error {
	a.log.Info("Restart requested via IPC")
	select {
	case a.restartCh <- struct{}{}:
		return nil
	default:
		return fmt.Errorf("restart already in progress")
	}
}
