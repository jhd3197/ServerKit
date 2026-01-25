package tray

import (
	"fmt"
	"os/exec"
	"runtime"
	"sync"
	"time"

	"fyne.io/systray"
)

// AppConfig holds tray app configuration
type AppConfig struct {
	Version      string
	IPCAddress   string
	IPCPort      int
	ServerURL    string
	DashboardURL string
	LogFile      string
}

// App is the system tray application
type App struct {
	config AppConfig
	client *Client

	// Current state
	mu              sync.RWMutex
	connected       bool
	agentRunning    bool
	lastStatus      string
	cpuPercent      float64
	memPercent      float64

	// Menu items
	menuStatus      *systray.MenuItem
	menuCPU         *systray.MenuItem
	menuMem         *systray.MenuItem
	menuStartAgent  *systray.MenuItem
	menuStopAgent   *systray.MenuItem
	menuRestartAgent *systray.MenuItem
	menuViewLogs    *systray.MenuItem
	menuDashboard   *systray.MenuItem
	menuAbout       *systray.MenuItem
	menuQuit        *systray.MenuItem

	// Control channels
	quitCh chan struct{}
}

// NewApp creates a new tray application
func NewApp(config AppConfig) *App {
	return &App{
		config: config,
		client: NewClient(config.IPCAddress, config.IPCPort),
		quitCh: make(chan struct{}),
	}
}

// Run starts the tray application (blocking)
func (a *App) Run() {
	systray.Run(a.onReady, a.onExit)
}

// Quit requests the tray app to quit
func (a *App) Quit() {
	close(a.quitCh)
	systray.Quit()
}

func (a *App) onReady() {
	// Set initial icon (gray/stopped)
	systray.SetIcon(GetIcon(IconStateStopped))
	systray.SetTitle("ServerKit")
	systray.SetTooltip("ServerKit Agent - Checking...")

	// Create menu items
	a.menuStatus = systray.AddMenuItem("Status: Checking...", "Agent status")
	a.menuStatus.Disable()

	a.menuCPU = systray.AddMenuItem("CPU: --", "CPU usage")
	a.menuCPU.Disable()

	a.menuMem = systray.AddMenuItem("Memory: --", "Memory usage")
	a.menuMem.Disable()

	systray.AddSeparator()

	a.menuStartAgent = systray.AddMenuItem("Start Agent", "Start the ServerKit agent service")
	a.menuStopAgent = systray.AddMenuItem("Stop Agent", "Stop the ServerKit agent service")
	a.menuRestartAgent = systray.AddMenuItem("Restart Agent", "Restart the ServerKit agent service")

	systray.AddSeparator()

	a.menuViewLogs = systray.AddMenuItem("View Logs", "Open log file")
	a.menuDashboard = systray.AddMenuItem("Open Dashboard", "Open ServerKit dashboard in browser")
	if a.config.DashboardURL == "" {
		a.menuDashboard.Disable()
	}

	systray.AddSeparator()

	a.menuAbout = systray.AddMenuItem(fmt.Sprintf("About ServerKit Tray v%s", a.config.Version), "About this application")
	a.menuAbout.Disable()

	a.menuQuit = systray.AddMenuItem("Quit Tray", "Exit the tray application")

	// Start background refresh
	go a.refreshLoop()

	// Handle menu clicks
	go a.handleMenuClicks()
}

func (a *App) onExit() {
	// Cleanup on exit
}

func (a *App) refreshLoop() {
	// Initial fetch
	a.refresh()

	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-a.quitCh:
			return
		case <-ticker.C:
			a.refresh()
		}
	}
}

func (a *App) refresh() {
	status, err := a.client.GetStatus()

	a.mu.Lock()
	defer a.mu.Unlock()

	if err != nil {
		// Agent not reachable
		a.agentRunning = false
		a.connected = false
		a.lastStatus = "Agent Not Running"
		systray.SetIcon(GetIcon(IconStateStopped))
		systray.SetTooltip("ServerKit Agent - Not Running")
		a.menuStatus.SetTitle("Status: Agent Not Running")
		a.menuCPU.SetTitle("CPU: --")
		a.menuMem.SetTitle("Memory: --")
		a.menuStartAgent.Enable()
		a.menuStopAgent.Disable()
		a.menuRestartAgent.Disable()
		return
	}

	a.agentRunning = status.Running
	a.connected = status.Connected
	a.cpuPercent = status.CPUPercent
	a.memPercent = status.MemPercent

	// Update icon based on connection state
	if status.Connected {
		a.lastStatus = "Connected"
		systray.SetIcon(GetIcon(IconStateConnected))
		systray.SetTooltip(fmt.Sprintf("ServerKit Agent - Connected | CPU: %.1f%% | Mem: %.1f%%",
			status.CPUPercent, status.MemPercent))
	} else if status.Running {
		a.lastStatus = "Disconnected"
		systray.SetIcon(GetIcon(IconStateDisconnected))
		systray.SetTooltip("ServerKit Agent - Disconnected from server")
	} else {
		a.lastStatus = "Stopped"
		systray.SetIcon(GetIcon(IconStateStopped))
		systray.SetTooltip("ServerKit Agent - Stopped")
	}

	// Update menu items
	a.menuStatus.SetTitle(fmt.Sprintf("Status: %s", a.lastStatus))
	a.menuCPU.SetTitle(fmt.Sprintf("CPU: %.1f%%", status.CPUPercent))
	a.menuMem.SetTitle(fmt.Sprintf("Memory: %.1f%%", status.MemPercent))

	// Enable/disable service controls
	if status.Running {
		a.menuStartAgent.Disable()
		a.menuStopAgent.Enable()
		a.menuRestartAgent.Enable()
	} else {
		a.menuStartAgent.Enable()
		a.menuStopAgent.Disable()
		a.menuRestartAgent.Disable()
	}
}

func (a *App) handleMenuClicks() {
	for {
		select {
		case <-a.quitCh:
			return
		case <-a.menuStartAgent.ClickedCh:
			a.startAgent()
		case <-a.menuStopAgent.ClickedCh:
			a.stopAgent()
		case <-a.menuRestartAgent.ClickedCh:
			a.restartAgent()
		case <-a.menuViewLogs.ClickedCh:
			a.viewLogs()
		case <-a.menuDashboard.ClickedCh:
			a.openDashboard()
		case <-a.menuQuit.ClickedCh:
			systray.Quit()
			return
		}
	}
}

func (a *App) startAgent() {
	if err := startService(); err != nil {
		a.showNotification("Failed to Start", err.Error())
		return
	}
	a.showNotification("Agent Started", "ServerKit agent service started")
	// Refresh immediately
	time.Sleep(1 * time.Second)
	a.refresh()
}

func (a *App) stopAgent() {
	if err := stopService(); err != nil {
		a.showNotification("Failed to Stop", err.Error())
		return
	}
	a.showNotification("Agent Stopped", "ServerKit agent service stopped")
	a.refresh()
}

func (a *App) restartAgent() {
	// Try IPC restart first (graceful)
	if a.client.IsAgentRunning() {
		if err := a.client.Restart(); err == nil {
			a.showNotification("Agent Restarting", "ServerKit agent is restarting")
			time.Sleep(2 * time.Second)
			a.refresh()
			return
		}
	}

	// Fall back to service restart
	if err := restartService(); err != nil {
		a.showNotification("Failed to Restart", err.Error())
		return
	}
	a.showNotification("Agent Restarted", "ServerKit agent service restarted")
	time.Sleep(2 * time.Second)
	a.refresh()
}

func (a *App) viewLogs() {
	if a.config.LogFile == "" {
		return
	}
	openFile(a.config.LogFile)
}

func (a *App) openDashboard() {
	if a.config.DashboardURL == "" {
		return
	}
	openURL(a.config.DashboardURL)
}

func (a *App) showNotification(title, message string) {
	// Note: systray doesn't have built-in notification support
	// For now, this is a placeholder - could use beeep or toast libraries
	fmt.Printf("Notification: %s - %s\n", title, message)
}

// Platform-specific helpers

func startService() error {
	if runtime.GOOS == "windows" {
		return exec.Command("sc", "start", "ServerKitAgent").Run()
	}
	return exec.Command("systemctl", "start", "serverkit-agent").Run()
}

func stopService() error {
	if runtime.GOOS == "windows" {
		return exec.Command("sc", "stop", "ServerKitAgent").Run()
	}
	return exec.Command("systemctl", "stop", "serverkit-agent").Run()
}

func restartService() error {
	if runtime.GOOS == "windows" {
		// Windows doesn't have restart, so stop then start
		stopService()
		time.Sleep(1 * time.Second)
		return startService()
	}
	return exec.Command("systemctl", "restart", "serverkit-agent").Run()
}

func openURL(url string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	return cmd.Start()
}

func openFile(path string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("notepad", path)
	case "darwin":
		cmd = exec.Command("open", "-t", path)
	default:
		cmd = exec.Command("xdg-open", path)
	}
	return cmd.Start()
}
