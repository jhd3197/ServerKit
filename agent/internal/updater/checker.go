package updater

import (
	"context"
	"sync"
	"time"

	"github.com/serverkit/agent/internal/config"
	"github.com/serverkit/agent/internal/logger"
)

// UpdateChecker runs periodic update checks
type UpdateChecker struct {
	updater *Updater
	cfg     *config.Config
	log     *logger.Logger

	mu            sync.Mutex
	lastCheck     time.Time
	latestVersion string
	updatePending bool
}

// NewChecker creates a new update checker
func NewChecker(cfg *config.Config, log *logger.Logger, currentVersion string) *UpdateChecker {
	return &UpdateChecker{
		updater: New(cfg, log, currentVersion),
		cfg:     cfg,
		log:     log,
	}
}

// Start begins the periodic update check routine
func (c *UpdateChecker) Start(ctx context.Context) {
	if !c.cfg.Update.Enabled {
		c.log.Info("Auto-update checks disabled")
		return
	}

	c.log.Info("Starting update checker",
		"interval", c.cfg.Update.CheckInterval,
		"auto_install", c.cfg.Update.AutoInstall,
	)

	// Do initial check after a short delay
	go func() {
		select {
		case <-ctx.Done():
			return
		case <-time.After(1 * time.Minute):
			c.checkAndNotify(ctx)
		}
	}()

	// Start periodic checks
	ticker := time.NewTicker(c.cfg.Update.CheckInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			c.log.Debug("Update checker stopped")
			return
		case <-ticker.C:
			c.checkAndNotify(ctx)
		}
	}
}

func (c *UpdateChecker) checkAndNotify(ctx context.Context) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.lastCheck = time.Now()

	info, err := c.updater.CheckForUpdate(ctx)
	if err != nil {
		c.log.Warn("Update check failed", "error", err)
		return
	}

	if !info.UpdateAvailable {
		c.log.Debug("No update available")
		c.updatePending = false
		return
	}

	c.latestVersion = info.LatestVersion
	c.updatePending = true

	c.log.Info("Update available",
		"current", info.CurrentVersion,
		"latest", info.LatestVersion,
	)

	// Auto-install if enabled
	if c.cfg.Update.AutoInstall {
		c.log.Info("Auto-install enabled, downloading update...")
		if err := c.installUpdate(ctx, info); err != nil {
			c.log.Error("Auto-update failed", "error", err)
		}
	}
}

func (c *UpdateChecker) installUpdate(ctx context.Context, info *VersionInfo) error {
	binaryPath, err := c.updater.DownloadUpdate(ctx, info)
	if err != nil {
		return err
	}

	if err := c.updater.InstallUpdate(binaryPath); err != nil {
		c.updater.Cleanup(binaryPath)
		return err
	}

	return nil
}

// CheckNow performs an immediate update check
func (c *UpdateChecker) CheckNow(ctx context.Context) (*VersionInfo, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.lastCheck = time.Now()
	return c.updater.CheckForUpdate(ctx)
}

// GetUpdater returns the underlying updater for manual operations
func (c *UpdateChecker) GetUpdater() *Updater {
	return c.updater
}

// HasPendingUpdate returns true if an update is available
func (c *UpdateChecker) HasPendingUpdate() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.updatePending
}

// GetLatestVersion returns the latest available version
func (c *UpdateChecker) GetLatestVersion() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.latestVersion
}

// GetLastCheck returns when the last check was performed
func (c *UpdateChecker) GetLastCheck() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.lastCheck
}
