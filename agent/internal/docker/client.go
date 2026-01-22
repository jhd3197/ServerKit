package docker

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/docker/docker/api/types"
	containertypes "github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/filters"
	volumetypes "github.com/docker/docker/api/types/volume"
	"github.com/docker/docker/client"
	"github.com/serverkit/agent/internal/config"
	"github.com/serverkit/agent/internal/logger"
)

// Client wraps the Docker client with additional functionality
type Client struct {
	cli *client.Client
	cfg config.DockerConfig
	log *logger.Logger
}

// ContainerInfo represents container information
type ContainerInfo struct {
	ID      string            `json:"id"`
	Name    string            `json:"name"`
	Image   string            `json:"image"`
	ImageID string            `json:"image_id"`
	Command string            `json:"command"`
	Created int64             `json:"created"`
	State   string            `json:"state"`
	Status  string            `json:"status"`
	Ports   []PortMapping     `json:"ports"`
	Labels  map[string]string `json:"labels"`
}

// PortMapping represents a port mapping
type PortMapping struct {
	IP          string `json:"ip,omitempty"`
	PrivatePort uint16 `json:"private_port"`
	PublicPort  uint16 `json:"public_port,omitempty"`
	Type        string `json:"type"`
}

// ContainerStats represents container statistics
type ContainerStats struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	CPUPercent    float64 `json:"cpu_percent"`
	MemoryUsage   uint64  `json:"memory_usage"`
	MemoryLimit   uint64  `json:"memory_limit"`
	MemoryPercent float64 `json:"memory_percent"`
	NetworkRx     uint64  `json:"network_rx"`
	NetworkTx     uint64  `json:"network_tx"`
	BlockRead     uint64  `json:"block_read"`
	BlockWrite    uint64  `json:"block_write"`
	PIDs          uint64  `json:"pids"`
}

// ImageInfo represents image information
type ImageInfo struct {
	ID          string   `json:"id"`
	RepoTags    []string `json:"repo_tags"`
	RepoDigests []string `json:"repo_digests"`
	Created     int64    `json:"created"`
	Size        int64    `json:"size"`
}

// VolumeInfo represents volume information
type VolumeInfo struct {
	Name       string            `json:"name"`
	Driver     string            `json:"driver"`
	Mountpoint string            `json:"mountpoint"`
	Labels     map[string]string `json:"labels"`
	Scope      string            `json:"scope"`
	CreatedAt  string            `json:"created_at"`
}

// NetworkInfo represents network information
type NetworkInfo struct {
	ID         string            `json:"id"`
	Name       string            `json:"name"`
	Driver     string            `json:"driver"`
	Scope      string            `json:"scope"`
	Internal   bool              `json:"internal"`
	Labels     map[string]string `json:"labels"`
	Containers int               `json:"containers"`
}

// NewClient creates a new Docker client
func NewClient(cfg config.DockerConfig, log *logger.Logger) (*Client, error) {
	var opts []client.Opt

	// Set host if configured
	if cfg.Socket != "" {
		host := cfg.Socket
		// Convert socket path to Docker format
		if strings.HasPrefix(host, "/") {
			host = "unix://" + host
		}
		opts = append(opts, client.WithHost(host))
	}

	opts = append(opts, client.WithAPIVersionNegotiation())

	if cfg.Timeout > 0 {
		opts = append(opts, client.WithTimeout(cfg.Timeout))
	}

	cli, err := client.NewClientWithOpts(opts...)
	if err != nil {
		return nil, fmt.Errorf("failed to create Docker client: %w", err)
	}

	return &Client{
		cli: cli,
		cfg: cfg,
		log: log.WithComponent("docker"),
	}, nil
}

// Ping checks if Docker is available
func (c *Client) Ping(ctx context.Context) error {
	_, err := c.cli.Ping(ctx)
	return err
}

// Version returns the Docker version
func (c *Client) Version(ctx context.Context) (string, error) {
	info, err := c.cli.ServerVersion(ctx)
	if err != nil {
		return "", err
	}
	return info.Version, nil
}

// Info returns Docker system info
func (c *Client) Info(ctx context.Context) (*types.Info, error) {
	info, err := c.cli.Info(ctx)
	if err != nil {
		return nil, err
	}
	return &info, nil
}

// ListContainers lists all containers
func (c *Client) ListContainers(ctx context.Context, all bool) ([]ContainerInfo, error) {
	containers, err := c.cli.ContainerList(ctx, types.ContainerListOptions{
		All: all,
	})
	if err != nil {
		return nil, err
	}

	result := make([]ContainerInfo, len(containers))
	for i, cont := range containers {
		ports := make([]PortMapping, len(cont.Ports))
		for j, p := range cont.Ports {
			ports[j] = PortMapping{
				IP:          p.IP,
				PrivatePort: p.PrivatePort,
				PublicPort:  p.PublicPort,
				Type:        p.Type,
			}
		}

		name := ""
		if len(cont.Names) > 0 {
			name = strings.TrimPrefix(cont.Names[0], "/")
		}

		result[i] = ContainerInfo{
			ID:      cont.ID[:12],
			Name:    name,
			Image:   cont.Image,
			ImageID: cont.ImageID,
			Command: cont.Command,
			Created: cont.Created,
			State:   cont.State,
			Status:  cont.Status,
			Ports:   ports,
			Labels:  cont.Labels,
		}
	}

	return result, nil
}

// InspectContainer inspects a container
func (c *Client) InspectContainer(ctx context.Context, id string) (*types.ContainerJSON, error) {
	cont, err := c.cli.ContainerInspect(ctx, id)
	if err != nil {
		return nil, err
	}
	return &cont, nil
}

// StartContainer starts a container
func (c *Client) StartContainer(ctx context.Context, id string) error {
	return c.cli.ContainerStart(ctx, id, types.ContainerStartOptions{})
}

// StopContainer stops a container
func (c *Client) StopContainer(ctx context.Context, id string, timeout *int) error {
	var stopOpts containertypes.StopOptions
	if timeout != nil {
		stopOpts.Timeout = timeout
	}
	return c.cli.ContainerStop(ctx, id, stopOpts)
}

// RestartContainer restarts a container
func (c *Client) RestartContainer(ctx context.Context, id string, timeout *int) error {
	var stopOpts containertypes.StopOptions
	if timeout != nil {
		stopOpts.Timeout = timeout
	}
	return c.cli.ContainerRestart(ctx, id, stopOpts)
}

// RemoveContainer removes a container
func (c *Client) RemoveContainer(ctx context.Context, id string, force, removeVolumes bool) error {
	return c.cli.ContainerRemove(ctx, id, types.ContainerRemoveOptions{
		Force:         force,
		RemoveVolumes: removeVolumes,
	})
}

// ContainerLogs returns container logs
func (c *Client) ContainerLogs(ctx context.Context, id string, tail string, since string, follow bool) (io.ReadCloser, error) {
	opts := types.ContainerLogsOptions{
		ShowStdout: true,
		ShowStderr: true,
		Follow:     follow,
		Timestamps: true,
	}

	if tail != "" {
		opts.Tail = tail
	}

	if since != "" {
		opts.Since = since
	}

	return c.cli.ContainerLogs(ctx, id, opts)
}

// ContainerStats returns container stats
func (c *Client) ContainerStats(ctx context.Context, id string) (*ContainerStats, error) {
	resp, err := c.cli.ContainerStats(ctx, id, false)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var stats types.StatsJSON
	if err := json.NewDecoder(resp.Body).Decode(&stats); err != nil {
		return nil, err
	}

	// Calculate CPU percentage
	cpuPercent := calculateCPUPercent(&stats)

	// Calculate memory percentage
	memPercent := 0.0
	if stats.MemoryStats.Limit > 0 {
		memPercent = float64(stats.MemoryStats.Usage) / float64(stats.MemoryStats.Limit) * 100
	}

	// Calculate network I/O
	var rx, tx uint64
	for _, net := range stats.Networks {
		rx += net.RxBytes
		tx += net.TxBytes
	}

	// Calculate block I/O
	var read, write uint64
	for _, bio := range stats.BlkioStats.IoServiceBytesRecursive {
		if bio.Op == "Read" {
			read += bio.Value
		} else if bio.Op == "Write" {
			write += bio.Value
		}
	}

	// Get container name
	inspect, _ := c.cli.ContainerInspect(ctx, id)
	name := strings.TrimPrefix(inspect.Name, "/")

	return &ContainerStats{
		ID:            id[:12],
		Name:          name,
		CPUPercent:    cpuPercent,
		MemoryUsage:   stats.MemoryStats.Usage,
		MemoryLimit:   stats.MemoryStats.Limit,
		MemoryPercent: memPercent,
		NetworkRx:     rx,
		NetworkTx:     tx,
		BlockRead:     read,
		BlockWrite:    write,
		PIDs:          stats.PidsStats.Current,
	}, nil
}

// ListImages lists all images
func (c *Client) ListImages(ctx context.Context) ([]ImageInfo, error) {
	images, err := c.cli.ImageList(ctx, types.ImageListOptions{})
	if err != nil {
		return nil, err
	}

	result := make([]ImageInfo, len(images))
	for i, img := range images {
		result[i] = ImageInfo{
			ID:          img.ID,
			RepoTags:    img.RepoTags,
			RepoDigests: img.RepoDigests,
			Created:     img.Created,
			Size:        img.Size,
		}
	}

	return result, nil
}

// PullImage pulls an image
func (c *Client) PullImage(ctx context.Context, imageName string) (io.ReadCloser, error) {
	return c.cli.ImagePull(ctx, imageName, types.ImagePullOptions{})
}

// RemoveImage removes an image
func (c *Client) RemoveImage(ctx context.Context, id string, force bool) error {
	_, err := c.cli.ImageRemove(ctx, id, types.ImageRemoveOptions{
		Force: force,
	})
	return err
}

// ListVolumes lists all volumes
func (c *Client) ListVolumes(ctx context.Context) ([]VolumeInfo, error) {
	resp, err := c.cli.VolumeList(ctx, volumetypes.ListOptions{})
	if err != nil {
		return nil, err
	}

	result := make([]VolumeInfo, len(resp.Volumes))
	for i, vol := range resp.Volumes {
		result[i] = VolumeInfo{
			Name:       vol.Name,
			Driver:     vol.Driver,
			Mountpoint: vol.Mountpoint,
			Labels:     vol.Labels,
			Scope:      vol.Scope,
			CreatedAt:  vol.CreatedAt,
		}
	}

	return result, nil
}

// CreateVolume creates a volume
func (c *Client) CreateVolume(ctx context.Context, name, driver string, labels map[string]string) (*VolumeInfo, error) {
	vol, err := c.cli.VolumeCreate(ctx, volumetypes.CreateOptions{
		Name:   name,
		Driver: driver,
		Labels: labels,
	})
	if err != nil {
		return nil, err
	}

	return &VolumeInfo{
		Name:       vol.Name,
		Driver:     vol.Driver,
		Mountpoint: vol.Mountpoint,
		Labels:     vol.Labels,
		Scope:      vol.Scope,
		CreatedAt:  vol.CreatedAt,
	}, nil
}

// RemoveVolume removes a volume
func (c *Client) RemoveVolume(ctx context.Context, name string, force bool) error {
	return c.cli.VolumeRemove(ctx, name, force)
}

// ListNetworks lists all networks
func (c *Client) ListNetworks(ctx context.Context) ([]NetworkInfo, error) {
	networks, err := c.cli.NetworkList(ctx, types.NetworkListOptions{})
	if err != nil {
		return nil, err
	}

	result := make([]NetworkInfo, len(networks))
	for i, net := range networks {
		result[i] = NetworkInfo{
			ID:         net.ID[:12],
			Name:       net.Name,
			Driver:     net.Driver,
			Scope:      net.Scope,
			Internal:   net.Internal,
			Labels:     net.Labels,
			Containers: len(net.Containers),
		}
	}

	return result, nil
}

// GetContainerCount returns the number of containers
func (c *Client) GetContainerCount(ctx context.Context) (total int, running int, err error) {
	allContainers, err := c.cli.ContainerList(ctx, types.ContainerListOptions{All: true})
	if err != nil {
		return 0, 0, err
	}

	runningContainers, err := c.cli.ContainerList(ctx, types.ContainerListOptions{
		Filters: filters.NewArgs(filters.Arg("status", "running")),
	})
	if err != nil {
		return 0, 0, err
	}

	return len(allContainers), len(runningContainers), nil
}

// Close closes the Docker client
func (c *Client) Close() error {
	return c.cli.Close()
}

// calculateCPUPercent calculates CPU usage percentage
func calculateCPUPercent(stats *types.StatsJSON) float64 {
	cpuDelta := float64(stats.CPUStats.CPUUsage.TotalUsage - stats.PreCPUStats.CPUUsage.TotalUsage)
	systemDelta := float64(stats.CPUStats.SystemUsage - stats.PreCPUStats.SystemUsage)

	if systemDelta > 0 && cpuDelta > 0 {
		cpuPercent := (cpuDelta / systemDelta) * float64(stats.CPUStats.OnlineCPUs) * 100.0
		return cpuPercent
	}

	return 0.0
}

