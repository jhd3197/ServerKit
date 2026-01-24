package metrics

import (
	"context"
	"os"
	"runtime"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/mem"
	"github.com/shirou/gopsutil/v3/net"
	"github.com/shirou/gopsutil/v3/process"
	"github.com/serverkit/agent/internal/config"
	"github.com/serverkit/agent/internal/logger"
)

// Collector collects system metrics
type Collector struct {
	cfg config.MetricsConfig
	log *logger.Logger

	// Previous values for rate calculations
	prevNetworkRx uint64
	prevNetworkTx uint64
	prevTime      time.Time
}

// SystemMetrics contains all collected metrics
type SystemMetrics struct {
	Timestamp     int64   `json:"timestamp"`
	CPUPercent    float64 `json:"cpu_percent"`
	CPUPerCore    []float64 `json:"cpu_per_core,omitempty"`
	MemoryTotal   uint64  `json:"memory_total"`
	MemoryUsed    uint64  `json:"memory_used"`
	MemoryPercent float64 `json:"memory_percent"`
	SwapTotal     uint64  `json:"swap_total"`
	SwapUsed      uint64  `json:"swap_used"`
	SwapPercent   float64 `json:"swap_percent"`
	DiskTotal     uint64  `json:"disk_total"`
	DiskUsed      uint64  `json:"disk_used"`
	DiskPercent   float64 `json:"disk_percent"`
	NetworkRx     uint64  `json:"network_rx"`      // Bytes received (total)
	NetworkTx     uint64  `json:"network_tx"`      // Bytes transmitted (total)
	NetworkRxRate float64 `json:"network_rx_rate"` // Bytes/sec
	NetworkTxRate float64 `json:"network_tx_rate"` // Bytes/sec
	Uptime        uint64  `json:"uptime"`
	LoadAvg1     float64 `json:"load_avg_1,omitempty"`
	LoadAvg5     float64 `json:"load_avg_5,omitempty"`
	LoadAvg15    float64 `json:"load_avg_15,omitempty"`
}

// SystemInfo contains static system information
type SystemInfo struct {
	Hostname     string `json:"hostname"`
	OS           string `json:"os"`
	Platform     string `json:"platform"`
	PlatformVersion string `json:"platform_version"`
	KernelVersion string `json:"kernel_version"`
	Architecture string `json:"architecture"`
	CPUModel     string `json:"cpu_model"`
	CPUCores     int    `json:"cpu_cores"`
	CPUThreads   int    `json:"cpu_threads"`
	TotalMemory  uint64 `json:"total_memory"`
	TotalDisk    uint64 `json:"total_disk"`
}

// ProcessInfo contains process information
type ProcessInfo struct {
	PID        int32   `json:"pid"`
	Name       string  `json:"name"`
	Username   string  `json:"username"`
	CPUPercent float64 `json:"cpu_percent"`
	MemPercent float32 `json:"mem_percent"`
	MemRSS     uint64  `json:"mem_rss"`
	Status     string  `json:"status"`
	CreateTime int64   `json:"create_time"`
	Cmdline    string  `json:"cmdline"`
}

// NewCollector creates a new metrics collector
func NewCollector(cfg config.MetricsConfig, log *logger.Logger) *Collector {
	return &Collector{
		cfg:      cfg,
		log:      log.WithComponent("metrics"),
		prevTime: time.Now(),
	}
}

// Collect collects current system metrics
func (c *Collector) Collect(ctx context.Context) (*SystemMetrics, error) {
	now := time.Now()
	metrics := &SystemMetrics{
		Timestamp: now.UnixMilli(),
	}

	// CPU usage
	cpuPercent, err := cpu.PercentWithContext(ctx, 0, false)
	if err == nil && len(cpuPercent) > 0 {
		metrics.CPUPercent = cpuPercent[0]
	}

	// Per-core CPU (optional)
	if c.cfg.IncludePerCPU {
		perCore, err := cpu.PercentWithContext(ctx, 0, true)
		if err == nil {
			metrics.CPUPerCore = perCore
		}
	}

	// Memory
	memInfo, err := mem.VirtualMemoryWithContext(ctx)
	if err == nil {
		metrics.MemoryTotal = memInfo.Total
		metrics.MemoryUsed = memInfo.Used
		metrics.MemoryPercent = memInfo.UsedPercent
	}

	// Swap
	swapInfo, err := mem.SwapMemoryWithContext(ctx)
	if err == nil {
		metrics.SwapTotal = swapInfo.Total
		metrics.SwapUsed = swapInfo.Used
		metrics.SwapPercent = swapInfo.UsedPercent
	}

	// Disk (root partition)
	diskPath := "/"
	if runtime.GOOS == "windows" {
		diskPath = "C:\\"
	}
	diskInfo, err := disk.UsageWithContext(ctx, diskPath)
	if err == nil {
		metrics.DiskTotal = diskInfo.Total
		metrics.DiskUsed = diskInfo.Used
		metrics.DiskPercent = diskInfo.UsedPercent
	}

	// Network I/O
	netIO, err := net.IOCountersWithContext(ctx, false)
	if err == nil && len(netIO) > 0 {
		metrics.NetworkRx = netIO[0].BytesRecv
		metrics.NetworkTx = netIO[0].BytesSent

		// Calculate rate
		elapsed := now.Sub(c.prevTime).Seconds()
		if elapsed > 0 && c.prevNetworkRx > 0 {
			metrics.NetworkRxRate = float64(netIO[0].BytesRecv-c.prevNetworkRx) / elapsed
			metrics.NetworkTxRate = float64(netIO[0].BytesSent-c.prevNetworkTx) / elapsed
		}

		c.prevNetworkRx = netIO[0].BytesRecv
		c.prevNetworkTx = netIO[0].BytesSent
	}

	// Uptime
	hostInfo, err := host.InfoWithContext(ctx)
	if err == nil {
		metrics.Uptime = hostInfo.Uptime
	}

	// Load average (Unix only)
	if runtime.GOOS != "windows" {
		loadAvg, err := cpu.Percent(0, false)
		if err == nil && len(loadAvg) > 0 {
			// Note: gopsutil load average is in misc package
			// Using a simple approximation here
		}
	}

	c.prevTime = now
	return metrics, nil
}

// GetSystemInfo returns static system information
func (c *Collector) GetSystemInfo(ctx context.Context) (*SystemInfo, error) {
	info := &SystemInfo{
		OS:           runtime.GOOS,
		Architecture: runtime.GOARCH,
	}

	// Hostname
	hostname, err := os.Hostname()
	if err == nil {
		info.Hostname = hostname
	}

	// Host info
	hostInfo, err := host.InfoWithContext(ctx)
	if err == nil {
		info.Platform = hostInfo.Platform
		info.PlatformVersion = hostInfo.PlatformVersion
		info.KernelVersion = hostInfo.KernelVersion
	}

	// CPU info
	cpuInfo, err := cpu.InfoWithContext(ctx)
	if err == nil && len(cpuInfo) > 0 {
		info.CPUModel = cpuInfo[0].ModelName
		info.CPUCores = int(cpuInfo[0].Cores)
	}

	// CPU count
	threads, err := cpu.CountsWithContext(ctx, true)
	if err == nil {
		info.CPUThreads = threads
	}
	cores, err := cpu.CountsWithContext(ctx, false)
	if err == nil {
		info.CPUCores = cores
	}

	// Memory
	memInfo, err := mem.VirtualMemoryWithContext(ctx)
	if err == nil {
		info.TotalMemory = memInfo.Total
	}

	// Disk
	diskPath := "/"
	if runtime.GOOS == "windows" {
		diskPath = "C:\\"
	}
	diskInfo, err := disk.UsageWithContext(ctx, diskPath)
	if err == nil {
		info.TotalDisk = diskInfo.Total
	}

	return info, nil
}

// ListProcesses returns a list of running processes
func (c *Collector) ListProcesses(ctx context.Context) ([]ProcessInfo, error) {
	procs, err := process.ProcessesWithContext(ctx)
	if err != nil {
		return nil, err
	}

	result := make([]ProcessInfo, 0, len(procs))
	for _, p := range procs {
		info := ProcessInfo{
			PID: p.Pid,
		}

		if name, err := p.NameWithContext(ctx); err == nil {
			info.Name = name
		}

		if username, err := p.UsernameWithContext(ctx); err == nil {
			info.Username = username
		}

		if cpuPct, err := p.CPUPercentWithContext(ctx); err == nil {
			info.CPUPercent = cpuPct
		}

		if memPct, err := p.MemoryPercentWithContext(ctx); err == nil {
			info.MemPercent = memPct
		}

		if memInfo, err := p.MemoryInfoWithContext(ctx); err == nil && memInfo != nil {
			info.MemRSS = memInfo.RSS
		}

		if status, err := p.StatusWithContext(ctx); err == nil && len(status) > 0 {
			info.Status = status[0]
		}

		if createTime, err := p.CreateTimeWithContext(ctx); err == nil {
			info.CreateTime = createTime
		}

		if cmdline, err := p.CmdlineWithContext(ctx); err == nil {
			info.Cmdline = cmdline
		}

		result = append(result, info)
	}

	return result, nil
}
