package config

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"gopkg.in/yaml.v3"
)

// Config holds all agent configuration
type Config struct {
	Server   ServerConfig   `yaml:"server"`
	Agent    AgentConfig    `yaml:"agent"`
	Auth     AuthConfig     `yaml:"auth"`
	Features FeaturesConfig `yaml:"features"`
	Metrics  MetricsConfig  `yaml:"metrics"`
	Docker   DockerConfig   `yaml:"docker"`
	Security SecurityConfig `yaml:"security"`
	Logging  LoggingConfig  `yaml:"logging"`
	Update   UpdateConfig   `yaml:"update"`
}

// ServerConfig holds connection settings
type ServerConfig struct {
	URL                  string        `yaml:"url"`
	ReconnectInterval    time.Duration `yaml:"reconnect_interval"`
	MaxReconnectInterval time.Duration `yaml:"max_reconnect_interval"`
	PingInterval         time.Duration `yaml:"ping_interval"`
	InsecureSkipVerify   bool          `yaml:"insecure_skip_verify"` // For dev only
}

// AgentConfig holds agent identity
type AgentConfig struct {
	ID   string `yaml:"id"`
	Name string `yaml:"name"`
}

// AuthConfig holds authentication credentials
type AuthConfig struct {
	KeyFile   string `yaml:"key_file"`
	APIKey    string `yaml:"api_key,omitempty"`    // Not saved to config file
	APISecret string `yaml:"api_secret,omitempty"` // Not saved to config file
}

// FeaturesConfig controls enabled features
type FeaturesConfig struct {
	Docker     bool `yaml:"docker"`
	Metrics    bool `yaml:"metrics"`
	Logs       bool `yaml:"logs"`
	FileAccess bool `yaml:"file_access"`
	Exec       bool `yaml:"exec"`
}

// MetricsConfig controls metrics collection
type MetricsConfig struct {
	Enabled           bool          `yaml:"enabled"`
	Interval          time.Duration `yaml:"interval"`
	IncludePerCPU     bool          `yaml:"include_per_cpu"`
	IncludeDockerStats bool         `yaml:"include_docker_stats"`
}

// DockerConfig holds Docker connection settings
type DockerConfig struct {
	Socket  string        `yaml:"socket"`
	Timeout time.Duration `yaml:"timeout"`
}

// SecurityConfig holds security settings
type SecurityConfig struct {
	AllowedPaths    []string      `yaml:"allowed_paths"`
	BlockedCommands []string      `yaml:"blocked_commands"`
	MaxExecTimeout  time.Duration `yaml:"max_exec_timeout"`
}

// LoggingConfig holds logging settings
type LoggingConfig struct {
	Level      string `yaml:"level"`
	File       string `yaml:"file"`
	MaxSize    int    `yaml:"max_size_mb"`
	MaxBackups int    `yaml:"max_backups"`
	MaxAge     int    `yaml:"max_age_days"`
	Compress   bool   `yaml:"compress"`
}

// UpdateConfig holds auto-update settings
type UpdateConfig struct {
	Enabled       bool          `yaml:"enabled"`
	CheckInterval time.Duration `yaml:"check_interval"`
	AutoInstall   bool          `yaml:"auto_install"`
}

// Default returns default configuration
func Default() *Config {
	return &Config{
		Server: ServerConfig{
			ReconnectInterval:    5 * time.Second,
			MaxReconnectInterval: 5 * time.Minute,
			PingInterval:         30 * time.Second,
		},
		Agent: AgentConfig{},
		Auth: AuthConfig{
			KeyFile: defaultKeyPath(),
		},
		Features: FeaturesConfig{
			Docker:     true,
			Metrics:    true,
			Logs:       true,
			FileAccess: false,
			Exec:       false,
		},
		Metrics: MetricsConfig{
			Enabled:           true,
			Interval:          10 * time.Second,
			IncludePerCPU:     true,
			IncludeDockerStats: true,
		},
		Docker: DockerConfig{
			Socket:  defaultDockerSocket(),
			Timeout: 30 * time.Second,
		},
		Security: SecurityConfig{
			AllowedPaths:    []string{},
			BlockedCommands: []string{},
			MaxExecTimeout:  5 * time.Minute,
		},
		Logging: LoggingConfig{
			Level:      "info",
			File:       defaultLogPath(),
			MaxSize:    100,
			MaxBackups: 5,
			MaxAge:     30,
			Compress:   true,
		},
		Update: UpdateConfig{
			Enabled:       true,
			CheckInterval: 1 * time.Hour,
			AutoInstall:   false, // Require manual confirmation by default
		},
	}
}

// Load loads configuration from file
func Load(path string) (*Config, error) {
	if path == "" {
		path = DefaultConfigPath()
	}

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("config file not found: %s", path)
		}
		return nil, fmt.Errorf("failed to read config: %w", err)
	}

	cfg := Default()
	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("failed to parse config: %w", err)
	}

	// Load credentials from secure storage
	if err := cfg.LoadCredentials(); err != nil {
		// Credentials may not exist yet (before registration)
		// This is not an error
	}

	return cfg, nil
}

// Save saves configuration to file
func (c *Config) Save(path string) error {
	if path == "" {
		path = DefaultConfigPath()
	}

	// Ensure directory exists
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create config directory: %w", err)
	}

	// Create a copy without sensitive data
	safeCfg := *c
	safeCfg.Auth.APIKey = ""
	safeCfg.Auth.APISecret = ""

	data, err := yaml.Marshal(&safeCfg)
	if err != nil {
		return fmt.Errorf("failed to marshal config: %w", err)
	}

	// Write with restricted permissions
	if err := os.WriteFile(path, data, 0600); err != nil {
		return fmt.Errorf("failed to write config: %w", err)
	}

	return nil
}

// Print prints configuration (excluding secrets)
func (c *Config) Print() {
	safeCfg := *c
	safeCfg.Auth.APIKey = "[REDACTED]"
	safeCfg.Auth.APISecret = "[REDACTED]"

	data, _ := yaml.Marshal(&safeCfg)
	fmt.Println(string(data))
}

// SaveCredentials saves API credentials securely
func (c *Config) SaveCredentials() error {
	if c.Auth.APIKey == "" || c.Auth.APISecret == "" {
		return nil
	}

	keyPath := c.Auth.KeyFile
	if keyPath == "" {
		keyPath = defaultKeyPath()
	}

	// Ensure directory exists
	dir := filepath.Dir(keyPath)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("failed to create key directory: %w", err)
	}

	// Create credential data
	creds := fmt.Sprintf("%s:%s", c.Auth.APIKey, c.Auth.APISecret)

	// Encrypt credentials using machine-specific key
	encrypted, err := encryptCredentials([]byte(creds))
	if err != nil {
		return fmt.Errorf("failed to encrypt credentials: %w", err)
	}

	// Write with restricted permissions
	if err := os.WriteFile(keyPath, encrypted, 0600); err != nil {
		return fmt.Errorf("failed to write key file: %w", err)
	}

	return nil
}

// LoadCredentials loads API credentials from secure storage
func (c *Config) LoadCredentials() error {
	keyPath := c.Auth.KeyFile
	if keyPath == "" {
		keyPath = defaultKeyPath()
	}

	data, err := os.ReadFile(keyPath)
	if err != nil {
		return fmt.Errorf("failed to read key file: %w", err)
	}

	// Decrypt credentials
	decrypted, err := decryptCredentials(data)
	if err != nil {
		return fmt.Errorf("failed to decrypt credentials: %w", err)
	}

	// Parse credentials
	var apiKey, apiSecret string
	if _, err := fmt.Sscanf(string(decrypted), "%s:%s", &apiKey, &apiSecret); err != nil {
		// Try splitting by colon
		parts := splitFirst(string(decrypted), ':')
		if len(parts) != 2 {
			return fmt.Errorf("invalid credentials format")
		}
		apiKey = parts[0]
		apiSecret = parts[1]
	}

	c.Auth.APIKey = apiKey
	c.Auth.APISecret = apiSecret

	return nil
}

// DefaultConfigPath returns the default config file path
func DefaultConfigPath() string {
	if runtime.GOOS == "windows" {
		return filepath.Join(os.Getenv("ProgramData"), "ServerKit", "Agent", "config.yaml")
	}
	return "/etc/serverkit-agent/config.yaml"
}

func defaultKeyPath() string {
	if runtime.GOOS == "windows" {
		return filepath.Join(os.Getenv("ProgramData"), "ServerKit", "Agent", "agent.key")
	}
	return "/etc/serverkit-agent/agent.key"
}

func defaultDockerSocket() string {
	if runtime.GOOS == "windows" {
		return "npipe:////./pipe/docker_engine"
	}
	return "unix:///var/run/docker.sock"
}

func defaultLogPath() string {
	if runtime.GOOS == "windows" {
		return filepath.Join(os.Getenv("ProgramData"), "ServerKit", "Agent", "logs", "agent.log")
	}
	return "/var/log/serverkit-agent/agent.log"
}

// getMachineKey generates a machine-specific encryption key
func getMachineKey() []byte {
	// Use machine-specific data to derive key
	// This makes the credentials only decryptable on this machine
	hostname, _ := os.Hostname()

	var machineID string
	if runtime.GOOS == "linux" {
		data, err := os.ReadFile("/etc/machine-id")
		if err == nil {
			machineID = string(data)
		}
	} else if runtime.GOOS == "windows" {
		// On Windows, use a combination of hostname and username
		machineID = os.Getenv("COMPUTERNAME") + os.Getenv("USERNAME")
	}

	combined := fmt.Sprintf("serverkit-agent:%s:%s", hostname, machineID)
	hash := sha256.Sum256([]byte(combined))
	return hash[:]
}

func encryptCredentials(plaintext []byte) ([]byte, error) {
	key := getMachineKey()

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}

	ciphertext := gcm.Seal(nonce, nonce, plaintext, nil)
	return []byte(base64.StdEncoding.EncodeToString(ciphertext)), nil
}

func decryptCredentials(data []byte) ([]byte, error) {
	key := getMachineKey()

	ciphertext, err := base64.StdEncoding.DecodeString(string(data))
	if err != nil {
		return nil, err
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonceSize := gcm.NonceSize()
	if len(ciphertext) < nonceSize {
		return nil, fmt.Errorf("ciphertext too short")
	}

	nonce, ciphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]
	return gcm.Open(nil, nonce, ciphertext, nil)
}

func splitFirst(s string, sep byte) []string {
	for i := 0; i < len(s); i++ {
		if s[i] == sep {
			return []string{s[:i], s[i+1:]}
		}
	}
	return []string{s}
}
