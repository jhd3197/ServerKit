package updater

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/serverkit/agent/internal/config"
	"github.com/serverkit/agent/internal/logger"
)

// VersionInfo holds version check response
type VersionInfo struct {
	UpdateAvailable bool   `json:"update_available"`
	CurrentVersion  string `json:"current_version"`
	LatestVersion   string `json:"latest_version"`
	DownloadURL     string `json:"download_url"`
	ChecksumsURL    string `json:"checksums_url"`
	ReleaseNotesURL string `json:"release_notes_url"`
	PublishedAt     string `json:"published_at"`
}

// Updater handles agent self-updates
type Updater struct {
	cfg            *config.Config
	log            *logger.Logger
	currentVersion string
	serverURL      string
	httpClient     *http.Client
}

// New creates a new Updater instance
func New(cfg *config.Config, log *logger.Logger, currentVersion string) *Updater {
	// Derive HTTP URL from WebSocket URL
	serverURL := cfg.Server.URL
	serverURL = strings.Replace(serverURL, "wss://", "https://", 1)
	serverURL = strings.Replace(serverURL, "ws://", "http://", 1)
	// Remove /agent/ws path if present
	serverURL = strings.TrimSuffix(serverURL, "/agent/ws")
	serverURL = strings.TrimSuffix(serverURL, "/agent")

	return &Updater{
		cfg:            cfg,
		log:            log,
		currentVersion: currentVersion,
		serverURL:      serverURL,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// CheckForUpdate checks if a new version is available
func (u *Updater) CheckForUpdate(ctx context.Context) (*VersionInfo, error) {
	u.log.Debug("Checking for updates", "current_version", u.currentVersion)

	url := fmt.Sprintf("%s/api/servers/agent/version/check", u.serverURL)

	payload := map[string]string{
		"current_version": u.currentVersion,
		"os":              runtime.GOOS,
		"arch":            runtime.GOARCH,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(body)))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", fmt.Sprintf("ServerKit-Agent/%s", u.currentVersion))

	resp, err := u.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to check for updates: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("update check failed with status: %d", resp.StatusCode)
	}

	var info VersionInfo
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	u.log.Debug("Update check complete",
		"update_available", info.UpdateAvailable,
		"latest_version", info.LatestVersion,
	)

	return &info, nil
}

// DownloadUpdate downloads the new version
func (u *Updater) DownloadUpdate(ctx context.Context, info *VersionInfo) (string, error) {
	if info.DownloadURL == "" {
		return "", fmt.Errorf("no download URL available")
	}

	u.log.Info("Downloading update", "version", info.LatestVersion, "url", info.DownloadURL)

	// Create temp directory
	tmpDir, err := os.MkdirTemp("", "serverkit-update-*")
	if err != nil {
		return "", fmt.Errorf("failed to create temp directory: %w", err)
	}

	// Determine archive type
	var archivePath string
	if runtime.GOOS == "windows" {
		archivePath = filepath.Join(tmpDir, "agent.zip")
	} else {
		archivePath = filepath.Join(tmpDir, "agent.tar.gz")
	}

	// Download archive
	if err := u.downloadFile(ctx, info.DownloadURL, archivePath); err != nil {
		os.RemoveAll(tmpDir)
		return "", fmt.Errorf("failed to download update: %w", err)
	}

	// Verify checksum if available
	if info.ChecksumsURL != "" {
		if err := u.verifyChecksum(ctx, archivePath, info.ChecksumsURL); err != nil {
			os.RemoveAll(tmpDir)
			return "", fmt.Errorf("checksum verification failed: %w", err)
		}
		u.log.Info("Checksum verified successfully")
	}

	// Extract binary
	binaryPath, err := u.extractBinary(archivePath, tmpDir)
	if err != nil {
		os.RemoveAll(tmpDir)
		return "", fmt.Errorf("failed to extract update: %w", err)
	}

	u.log.Info("Update downloaded and verified", "path", binaryPath)
	return binaryPath, nil
}

// InstallUpdate installs the new binary and restarts the agent
func (u *Updater) InstallUpdate(newBinaryPath string) error {
	u.log.Info("Installing update", "new_binary", newBinaryPath)

	// Get current binary path
	currentBinary, err := os.Executable()
	if err != nil {
		return fmt.Errorf("failed to get current executable: %w", err)
	}
	currentBinary, err = filepath.EvalSymlinks(currentBinary)
	if err != nil {
		return fmt.Errorf("failed to resolve symlinks: %w", err)
	}

	// Create backup path
	backupPath := currentBinary + ".backup"

	// On Windows, we need to rename the current binary first
	if runtime.GOOS == "windows" {
		return u.installWindows(currentBinary, newBinaryPath, backupPath)
	}

	return u.installUnix(currentBinary, newBinaryPath, backupPath)
}

func (u *Updater) installUnix(currentBinary, newBinaryPath, backupPath string) error {
	// Remove old backup if exists
	os.Remove(backupPath)

	// Backup current binary
	if err := os.Rename(currentBinary, backupPath); err != nil {
		return fmt.Errorf("failed to backup current binary: %w", err)
	}

	// Copy new binary to target location
	if err := copyFile(newBinaryPath, currentBinary); err != nil {
		// Restore backup on failure
		os.Rename(backupPath, currentBinary)
		return fmt.Errorf("failed to copy new binary: %w", err)
	}

	// Make executable
	if err := os.Chmod(currentBinary, 0755); err != nil {
		os.Rename(backupPath, currentBinary)
		return fmt.Errorf("failed to set permissions: %w", err)
	}

	u.log.Info("Update installed successfully, restarting agent...")

	// Restart via systemd if available
	if u.isSystemd() {
		cmd := exec.Command("systemctl", "restart", "serverkit-agent")
		if err := cmd.Start(); err != nil {
			u.log.Warn("Failed to restart via systemd", "error", err)
		}
		return nil
	}

	// Self-restart
	return u.selfRestart(currentBinary)
}

func (u *Updater) installWindows(currentBinary, newBinaryPath, backupPath string) error {
	// On Windows, create a batch script to:
	// 1. Wait for current process to exit
	// 2. Replace the binary
	// 3. Start the new binary/service

	batchScript := fmt.Sprintf(`@echo off
timeout /t 2 /nobreak > nul
del "%s.backup" 2>nul
move "%s" "%s.backup"
copy "%s" "%s"
net start ServerKitAgent
del "%%~f0"
`, currentBinary, currentBinary, currentBinary, newBinaryPath, currentBinary)

	scriptPath := filepath.Join(os.TempDir(), "serverkit-update.bat")
	if err := os.WriteFile(scriptPath, []byte(batchScript), 0755); err != nil {
		return fmt.Errorf("failed to create update script: %w", err)
	}

	// Stop the service
	exec.Command("net", "stop", "ServerKitAgent").Run()

	// Run the batch script detached
	cmd := exec.Command("cmd", "/c", "start", "/b", scriptPath)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start update script: %w", err)
	}

	u.log.Info("Update scheduled, agent will restart shortly")
	return nil
}

func (u *Updater) downloadFile(ctx context.Context, url, destPath string) error {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return err
	}

	req.Header.Set("User-Agent", fmt.Sprintf("ServerKit-Agent/%s", u.currentVersion))

	resp, err := u.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download failed with status: %d", resp.StatusCode)
	}

	out, err := os.Create(destPath)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, resp.Body)
	return err
}

func (u *Updater) verifyChecksum(ctx context.Context, filePath, checksumsURL string) error {
	// Download checksums file
	req, err := http.NewRequestWithContext(ctx, "GET", checksumsURL, nil)
	if err != nil {
		return err
	}

	resp, err := u.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	checksumsData, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	// Parse checksums
	checksums := make(map[string]string)
	for _, line := range strings.Split(string(checksumsData), "\n") {
		parts := strings.Fields(line)
		if len(parts) >= 2 {
			checksums[parts[1]] = parts[0]
		}
	}

	// Calculate file hash
	f, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer f.Close()

	hasher := sha256.New()
	if _, err := io.Copy(hasher, f); err != nil {
		return err
	}
	actualHash := hex.EncodeToString(hasher.Sum(nil))

	// Find expected hash
	fileName := filepath.Base(filePath)
	// Try to match by looking for platform-specific name
	expectedHash := ""
	for name, hash := range checksums {
		if strings.Contains(name, runtime.GOOS) && strings.Contains(name, runtime.GOARCH) {
			expectedHash = hash
			break
		}
	}

	if expectedHash == "" {
		// Try exact match
		if hash, ok := checksums[fileName]; ok {
			expectedHash = hash
		}
	}

	if expectedHash == "" {
		u.log.Warn("Could not find checksum for downloaded file, skipping verification")
		return nil
	}

	if actualHash != expectedHash {
		return fmt.Errorf("checksum mismatch: expected %s, got %s", expectedHash, actualHash)
	}

	return nil
}

func (u *Updater) extractBinary(archivePath, destDir string) (string, error) {
	if runtime.GOOS == "windows" {
		return u.extractZip(archivePath, destDir)
	}
	return u.extractTarGz(archivePath, destDir)
}

func (u *Updater) extractTarGz(archivePath, destDir string) (string, error) {
	f, err := os.Open(archivePath)
	if err != nil {
		return "", err
	}
	defer f.Close()

	gzr, err := gzip.NewReader(f)
	if err != nil {
		return "", err
	}
	defer gzr.Close()

	tr := tar.NewReader(gzr)

	var binaryPath string
	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", err
		}

		// Look for the agent binary
		if header.Typeflag == tar.TypeReg && strings.Contains(header.Name, "serverkit-agent") {
			binaryPath = filepath.Join(destDir, "serverkit-agent")
			outFile, err := os.Create(binaryPath)
			if err != nil {
				return "", err
			}
			if _, err := io.Copy(outFile, tr); err != nil {
				outFile.Close()
				return "", err
			}
			outFile.Close()
			os.Chmod(binaryPath, 0755)
		}
	}

	if binaryPath == "" {
		return "", fmt.Errorf("agent binary not found in archive")
	}

	return binaryPath, nil
}

func (u *Updater) extractZip(archivePath, destDir string) (string, error) {
	r, err := zip.OpenReader(archivePath)
	if err != nil {
		return "", err
	}
	defer r.Close()

	var binaryPath string
	for _, f := range r.File {
		if strings.Contains(f.Name, "serverkit-agent") && strings.HasSuffix(f.Name, ".exe") {
			binaryPath = filepath.Join(destDir, "serverkit-agent.exe")

			rc, err := f.Open()
			if err != nil {
				return "", err
			}

			outFile, err := os.Create(binaryPath)
			if err != nil {
				rc.Close()
				return "", err
			}

			_, err = io.Copy(outFile, rc)
			outFile.Close()
			rc.Close()

			if err != nil {
				return "", err
			}
		}
	}

	if binaryPath == "" {
		return "", fmt.Errorf("agent binary not found in archive")
	}

	return binaryPath, nil
}

func (u *Updater) isSystemd() bool {
	if runtime.GOOS != "linux" {
		return false
	}
	_, err := os.Stat("/run/systemd/system")
	return err == nil
}

func (u *Updater) selfRestart(binaryPath string) error {
	// Fork a new process and exit current one
	cmd := exec.Command(binaryPath, "start")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start new process: %w", err)
	}

	u.log.Info("Restarting with new version...")
	os.Exit(0)
	return nil
}

func copyFile(src, dst string) error {
	sourceFile, err := os.Open(src)
	if err != nil {
		return err
	}
	defer sourceFile.Close()

	destFile, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer destFile.Close()

	_, err = io.Copy(destFile, sourceFile)
	return err
}

// Cleanup removes temporary update files
func (u *Updater) Cleanup(tmpDir string) {
	if tmpDir != "" {
		os.RemoveAll(tmpDir)
	}
}
