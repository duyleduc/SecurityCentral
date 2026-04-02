// sc-agent is the SecurityCentral Infrastructure Agent.
// It runs on target servers to scan for OS vulnerabilities and misconfigurations.
package main

import (
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/spf13/cobra"

	"github.com/security-central/security-central/internal/agent"
	"github.com/security-central/security-central/internal/config"
	"github.com/security-central/security-central/internal/install"
	"github.com/security-central/security-central/internal/logging"
	"github.com/security-central/security-central/internal/platform"
	"github.com/security-central/security-central/internal/scanner/packages"
)

var version = "dev"

// ---------------------------------------------------------------------------
// Root command (defaults to "run" if no subcommand given)
// ---------------------------------------------------------------------------

var rootCmd = &cobra.Command{
	Use:   "sc-agent",
	Short: "SecurityCentral Infrastructure Agent",
	// When invoked without a subcommand (e.g. sc-agent --config ...),
	// behave the same as "sc-agent run".
	RunE: func(cmd *cobra.Command, args []string) error {
		return runAgent(cmd, args)
	},
	SilenceUsage: true,
}

// ---------------------------------------------------------------------------
// Run command — normal agent operation
// ---------------------------------------------------------------------------

var configPath string

var runCmd = &cobra.Command{
	Use:   "run",
	Short: "Run the agent (default)",
	RunE:  runAgent,
}

func runAgent(_ *cobra.Command, _ []string) error {
	logging.Init("sc-agent")
	slog.Info("starting agent", "version", version, "config", configPath)

	cfg, err := config.LoadAgentConfig(configPath)
	if err != nil {
		slog.Error("failed to load config", "error", err)
		os.Exit(2)
	}

	// Set up mTLS client
	mtlsClient, err := platform.NewMTLSClient(cfg.TLS.Cert, cfg.TLS.Key, cfg.TLS.CA)
	if err != nil {
		slog.Error("failed to create mTLS client", "error", err)
		os.Exit(2)
	}

	// Command channel for heartbeat → scheduler communication
	cmdCh := make(chan agent.Command, 10)

	// Start heartbeat loop in background
	go agent.HeartbeatLoop(mtlsClient.HTTPClient(), cfg.APIURL, cfg.AgentID, version, cfg.Heartbeat.Interval, cmdCh)

	// Define scan function
	scanFn := func() error {
		return packages.RunScan(mtlsClient, cfg)
	}

	// Start scan scheduler in background
	scheduler := agent.NewScheduler(cfg.Scan.Interval, cfg.Scan.OnStartup, scanFn, cmdCh)
	go scheduler.Run()

	// Wait for shutdown signal
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
	sig := <-sigCh
	slog.Info("shutting down", "signal", sig.String())

	return nil
}

// ---------------------------------------------------------------------------
// Install command — one-time agent setup using install token
// ---------------------------------------------------------------------------

var (
	installToken  string
	installAPIURL string
)

var installCmd = &cobra.Command{
	Use:   "install",
	Short: "Install and register this agent using a one-time token",
	RunE: func(_ *cobra.Command, _ []string) error {
		logging.Init("sc-agent-install")
		return install.Run(installToken, installAPIURL)
	},
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

func init() {
	// Flags shared between root and run (for backward compat: sc-agent --config ...)
	rootCmd.PersistentFlags().StringVar(&configPath, "config", "/etc/securitycentral/agent.yml", "Path to agent config file")
	runCmd.Flags().StringVar(&configPath, "config", "/etc/securitycentral/agent.yml", "Path to agent config file")

	installCmd.Flags().StringVar(&installToken, "token", "", "One-time install token from dashboard")
	installCmd.Flags().StringVar(&installAPIURL, "api-url", "https://api.securitycentral.io", "Platform API URL")
	_ = installCmd.MarkFlagRequired("token")

	rootCmd.AddCommand(runCmd, installCmd)
}

func main() {
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}
