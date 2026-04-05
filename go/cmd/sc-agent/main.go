// sc-agent is the SecurityCentral Infrastructure Agent.
// It runs on target servers to scan for OS vulnerabilities and misconfigurations.
package main

import (
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"

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

	// Set up HTTP client — mTLS for production (https), plain for local dev (http)
	var httpClient *http.Client
	var mtlsClient *platform.Client

	if strings.HasPrefix(cfg.APIURL, "https://") {
		var err2 error
		mtlsClient, err2 = platform.NewMTLSClient(cfg.TLS.Cert, cfg.TLS.Key, cfg.TLS.CA)
		if err2 != nil {
			slog.Error("failed to create mTLS client", "error", err2)
			os.Exit(2)
		}
		httpClient = mtlsClient.HTTPClient()
	} else {
		slog.Warn("API URL is HTTP — running without mTLS (dev mode)")
		httpClient = &http.Client{Timeout: 30 * time.Second}
	}

	// Channels for heartbeat → scheduler communication
	cmdCh := make(chan agent.Command, 10)
	configCh := make(chan agent.ConfigUpdate, 1)

	// TLS paths for cert renewal (nil in dev mode)
	var tlsPaths *agent.TLSPaths
	if mtlsClient != nil {
		tlsPaths = &agent.TLSPaths{Cert: cfg.TLS.Cert, Key: cfg.TLS.Key}
	}

	// Start heartbeat loop (uses default 60s interval, adjusted by server config)
	go agent.HeartbeatLoop(httpClient, cfg.APIURL, cfg.AgentID, version, tlsPaths, cmdCh, configCh)

	// Define scan function
	scanFn := func() error {
		if mtlsClient != nil {
			return packages.RunScan(mtlsClient, cfg)
		}
		slog.Warn("skipping scan — mTLS client not available in dev mode")
		return nil
	}

	// Start scan scheduler (uses default config, updated by heartbeat)
	scheduler := agent.NewScheduler(scanFn, cmdCh, configCh)
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
// Update command — download latest binary, replace self, restart
// ---------------------------------------------------------------------------

var updateForce bool

var updateCmd = &cobra.Command{
	Use:   "update",
	Short: "Update the agent binary to the latest version",
	RunE: func(_ *cobra.Command, _ []string) error {
		logging.Init("sc-agent-update")
		slog.Info("checking for updates", "current_version", version, "config", configPath)

		cfg, err := config.LoadAgentConfig(configPath)
		if err != nil {
			return fmt.Errorf("failed to load config: %w", err)
		}

		arch := runtime.GOARCH

		// Create HTTP client (mTLS or plain)
		var httpClient *http.Client
		if strings.HasPrefix(cfg.APIURL, "https://") {
			mtlsClient, err := platform.NewMTLSClient(cfg.TLS.Cert, cfg.TLS.Key, cfg.TLS.CA)
			if err != nil {
				return fmt.Errorf("failed to create mTLS client: %w", err)
			}
			httpClient = mtlsClient.HTTPClient()
		} else {
			httpClient = &http.Client{Timeout: 60 * time.Second}
		}

		updater := agent.NewSelfUpdater(httpClient, cfg.APIURL)
		if err := updater.Update(arch, version, updateForce); err != nil {
			return fmt.Errorf("update failed: %w", err)
		}

		fmt.Println("Agent updated successfully. Service is restarting.")
		return nil
	},
}

// ---------------------------------------------------------------------------
// Version command — print current version
// ---------------------------------------------------------------------------

var versionCmd = &cobra.Command{
	Use:   "version",
	Short: "Print the agent version",
	Run: func(_ *cobra.Command, _ []string) {
		fmt.Printf("sc-agent %s\n", version)
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

	updateCmd.Flags().BoolVar(&updateForce, "force", false, "Force update even if already on latest or downgrading")

	rootCmd.AddCommand(runCmd, installCmd, updateCmd, versionCmd)
}

func main() {
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}
