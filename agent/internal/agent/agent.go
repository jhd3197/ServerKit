package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/serverkit/agent/internal/auth"
	"github.com/serverkit/agent/internal/config"
	"github.com/serverkit/agent/internal/docker"
	"github.com/serverkit/agent/internal/logger"
	"github.com/serverkit/agent/internal/metrics"
	"github.com/serverkit/agent/internal/ws"
	"github.com/serverkit/agent/pkg/protocol"
)

// Agent is the main agent that coordinates all components
type Agent struct {
	cfg     *config.Config
	log     *logger.Logger
	auth    *auth.Authenticator
	ws      *ws.Client
	docker  *docker.Client
	metrics *metrics.Collector

	// Active subscriptions
	subscriptions map[string]context.CancelFunc
	subMu         sync.Mutex

	// Command handlers
	handlers map[string]CommandHandler
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

	agent := &Agent{
		cfg:           cfg,
		log:           log,
		auth:          authenticator,
		ws:            wsClient,
		docker:        dockerClient,
		metrics:       metricsCollector,
		subscriptions: make(map[string]context.CancelFunc),
		handlers:      make(map[string]CommandHandler),
	}

	// Register command handlers
	agent.registerHandlers()

	// Set WebSocket message handler
	wsClient.SetHandler(agent.handleMessage)

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
	}

	// System commands
	if a.metrics != nil {
		a.handlers[protocol.ActionSystemMetrics] = a.handleSystemMetrics
		a.handlers[protocol.ActionSystemInfo] = a.handleSystemInfo
		a.handlers[protocol.ActionSystemProcesses] = a.handleSystemProcesses
	}
}

// Run starts the agent
func (a *Agent) Run(ctx context.Context) error {
	a.log.Info("Starting agent",
		"agent_id", a.cfg.Agent.ID,
		"features", fmt.Sprintf("docker=%v metrics=%v", a.cfg.Features.Docker, a.cfg.Features.Metrics),
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

	// Start WebSocket connection in background
	go func() {
		if err := a.ws.Run(ctx); err != nil && err != context.Canceled {
			a.log.Error("WebSocket error", "error", err)
		}
	}()

	// Start heartbeat loop
	go a.heartbeatLoop(ctx)

	// Wait for context cancellation
	<-ctx.Done()

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
func (a *Agent) cleanup() {
	a.log.Info("Cleaning up...")

	// Cancel all subscriptions
	a.subMu.Lock()
	for _, cancel := range a.subscriptions {
		cancel()
	}
	a.subscriptions = make(map[string]context.CancelFunc)
	a.subMu.Unlock()

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
