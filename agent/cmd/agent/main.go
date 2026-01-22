package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/serverkit/agent/internal/agent"
	"github.com/serverkit/agent/internal/config"
	"github.com/serverkit/agent/internal/logger"
	"github.com/serverkit/agent/internal/updater"
	"github.com/spf13/cobra"
)

var (
	Version   = "dev"
	BuildTime = "unknown"
	GitCommit = "unknown"
)

var (
	cfgFile   string
	debugMode bool
)

func main() {
	rootCmd := &cobra.Command{
		Use:   "serverkit-agent",
		Short: "ServerKit Agent - Remote server management agent",
		Long: `ServerKit Agent connects your server to a ServerKit control plane,
enabling remote Docker management, monitoring, and more.`,
	}

	// Global flags
	rootCmd.PersistentFlags().StringVarP(&cfgFile, "config", "c", "", "config file path")
	rootCmd.PersistentFlags().BoolVarP(&debugMode, "debug", "d", false, "enable debug logging")

	// Add commands
	rootCmd.AddCommand(startCmd())
	rootCmd.AddCommand(registerCmd())
	rootCmd.AddCommand(statusCmd())
	rootCmd.AddCommand(versionCmd())
	rootCmd.AddCommand(configCmd())
	rootCmd.AddCommand(updateCmd())

	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func startCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "start",
		Short: "Start the agent service",
		RunE: func(cmd *cobra.Command, args []string) error {
			return runAgent()
		},
	}
}

func registerCmd() *cobra.Command {
	var token string
	var serverURL string
	var name string

	cmd := &cobra.Command{
		Use:   "register",
		Short: "Register this agent with a ServerKit instance",
		RunE: func(cmd *cobra.Command, args []string) error {
			return runRegister(token, serverURL, name)
		},
	}

	cmd.Flags().StringVarP(&token, "token", "t", "", "registration token (required)")
	cmd.Flags().StringVarP(&serverURL, "server", "s", "", "ServerKit server URL (required)")
	cmd.Flags().StringVarP(&name, "name", "n", "", "display name for this server")
	cmd.MarkFlagRequired("token")
	cmd.MarkFlagRequired("server")

	return cmd
}

func statusCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show agent status",
		RunE: func(cmd *cobra.Command, args []string) error {
			return showStatus()
		},
	}
}

func versionCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Show version information",
		Run: func(cmd *cobra.Command, args []string) {
			fmt.Printf("ServerKit Agent\n")
			fmt.Printf("  Version:    %s\n", Version)
			fmt.Printf("  Build Time: %s\n", BuildTime)
			fmt.Printf("  Git Commit: %s\n", GitCommit)
		},
	}
}

func configCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "config",
		Short: "Configuration management",
	}

	cmd.AddCommand(&cobra.Command{
		Use:   "show",
		Short: "Show current configuration",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := config.Load(cfgFile)
			if err != nil {
				return fmt.Errorf("failed to load config: %w", err)
			}
			cfg.Print()
			return nil
		},
	})

	cmd.AddCommand(&cobra.Command{
		Use:   "path",
		Short: "Show configuration file path",
		Run: func(cmd *cobra.Command, args []string) {
			fmt.Println(config.DefaultConfigPath())
		},
	})

	return cmd
}

func updateCmd() *cobra.Command {
	var forceUpdate bool
	var checkOnly bool

	cmd := &cobra.Command{
		Use:   "update",
		Short: "Check for and install updates",
		Long: `Check for available updates and optionally install them.

By default, this command checks for updates and prompts before installing.
Use --force to install without prompting.
Use --check to only check for updates without installing.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runUpdate(forceUpdate, checkOnly)
		},
	}

	cmd.Flags().BoolVarP(&forceUpdate, "force", "f", false, "install update without prompting")
	cmd.Flags().BoolVarP(&checkOnly, "check", "c", false, "only check for updates, don't install")

	return cmd
}

func runUpdate(force, checkOnly bool) error {
	// Load configuration
	cfg, err := config.Load(cfgFile)
	if err != nil {
		return fmt.Errorf("failed to load config: %w", err)
	}

	log := logger.New(config.LoggingConfig{Level: "info"})
	u := updater.New(cfg, log, Version)

	ctx := context.Background()

	fmt.Printf("Current version: %s\n", Version)
	fmt.Println("Checking for updates...")

	info, err := u.CheckForUpdate(ctx)
	if err != nil {
		return fmt.Errorf("failed to check for updates: %w", err)
	}

	if !info.UpdateAvailable {
		fmt.Println("You are running the latest version.")
		return nil
	}

	fmt.Printf("\nUpdate available: v%s -> v%s\n", info.CurrentVersion, info.LatestVersion)
	fmt.Printf("Published: %s\n", info.PublishedAt)
	if info.ReleaseNotesURL != "" {
		fmt.Printf("Release notes: %s\n", info.ReleaseNotesURL)
	}

	if checkOnly {
		return nil
	}

	// Prompt for confirmation unless forced
	if !force {
		fmt.Print("\nDo you want to install this update? [y/N]: ")
		var response string
		fmt.Scanln(&response)
		if response != "y" && response != "Y" {
			fmt.Println("Update cancelled.")
			return nil
		}
	}

	fmt.Println("\nDownloading update...")
	binaryPath, err := u.DownloadUpdate(ctx, info)
	if err != nil {
		return fmt.Errorf("failed to download update: %w", err)
	}

	fmt.Println("Installing update...")
	if err := u.InstallUpdate(binaryPath); err != nil {
		u.Cleanup(binaryPath)
		return fmt.Errorf("failed to install update: %w", err)
	}

	fmt.Println("\nUpdate installed successfully!")
	fmt.Println("The agent will restart with the new version.")

	return nil
}

func runAgent() error {
	// Load configuration
	cfg, err := config.Load(cfgFile)
	if err != nil {
		return fmt.Errorf("failed to load config: %w", err)
	}

	// Override debug mode if flag is set
	if debugMode {
		cfg.Logging.Level = "debug"
	}

	// Initialize logger
	log := logger.New(cfg.Logging)
	log.Info("Starting ServerKit Agent",
		"version", Version,
		"config", config.DefaultConfigPath(),
	)

	// Check if registered
	if cfg.Agent.ID == "" {
		return fmt.Errorf("agent not registered. Run 'serverkit-agent register' first")
	}

	// Create and start agent
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	ag, err := agent.New(cfg, log)
	if err != nil {
		return fmt.Errorf("failed to create agent: %w", err)
	}

	// Start update checker in background
	updateChecker := updater.NewChecker(cfg, log, Version)
	go updateChecker.Start(ctx)

	// Handle graceful shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		sig := <-sigCh
		log.Info("Received shutdown signal", "signal", sig.String())
		cancel()
	}()

	// Start agent
	if err := ag.Run(ctx); err != nil && err != context.Canceled {
		return fmt.Errorf("agent error: %w", err)
	}

	log.Info("Agent stopped gracefully")
	return nil
}

func runRegister(token, serverURL, name string) error {
	log := logger.New(config.LoggingConfig{Level: "info"})

	log.Info("Registering agent with ServerKit",
		"server", serverURL,
	)

	// Load or create config
	cfg, err := config.Load(cfgFile)
	if err != nil {
		// Create new config if doesn't exist
		cfg = config.Default()
	}

	// Register with server
	reg := agent.NewRegistration(log)
	result, err := reg.Register(serverURL, token, name)
	if err != nil {
		return fmt.Errorf("registration failed: %w", err)
	}

	// Update config
	cfg.Server.URL = result.WebSocketURL
	cfg.Agent.ID = result.AgentID
	cfg.Agent.Name = result.Name
	cfg.Auth.APIKey = result.APIKey
	cfg.Auth.APISecret = result.APISecret

	// Save config
	if err := cfg.Save(config.DefaultConfigPath()); err != nil {
		return fmt.Errorf("failed to save config: %w", err)
	}

	// Save credentials securely
	if err := cfg.SaveCredentials(); err != nil {
		return fmt.Errorf("failed to save credentials: %w", err)
	}

	log.Info("Registration successful!",
		"agent_id", result.AgentID,
		"name", result.Name,
	)

	fmt.Println("\nAgent registered successfully!")
	fmt.Printf("  Agent ID: %s\n", result.AgentID)
	fmt.Printf("  Name:     %s\n", result.Name)
	fmt.Println("\nStart the agent with: serverkit-agent start")

	return nil
}

func showStatus() error {
	cfg, err := config.Load(cfgFile)
	if err != nil {
		fmt.Println("Status: Not configured")
		fmt.Printf("  Config file not found at %s\n", config.DefaultConfigPath())
		fmt.Println("\nRun 'serverkit-agent register' to configure.")
		return nil
	}

	if cfg.Agent.ID == "" {
		fmt.Println("Status: Not registered")
		fmt.Println("\nRun 'serverkit-agent register' to register with a ServerKit instance.")
		return nil
	}

	fmt.Println("Status: Configured")
	fmt.Printf("  Agent ID:   %s\n", cfg.Agent.ID)
	fmt.Printf("  Agent Name: %s\n", cfg.Agent.Name)
	fmt.Printf("  Server:     %s\n", cfg.Server.URL)

	// TODO: Check if actually connected
	// This would require checking a PID file or socket

	return nil
}
