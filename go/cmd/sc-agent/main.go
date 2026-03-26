// sc-agent is the SecurityCentral Infrastructure Agent.
// It runs on target servers to scan for OS vulnerabilities and misconfigurations.
package main

import (
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/security-central/security-central/internal/agent"
	"github.com/security-central/security-central/internal/config"
	"github.com/security-central/security-central/internal/logging"
	"github.com/security-central/security-central/internal/platform"
	"github.com/security-central/security-central/internal/scanner/packages"
)

var version = "dev"

func main() {
	logging.Init("sc-agent")

	configPath := flag.String("config", "/etc/securitycentral/agent.yml", "Path to agent config file")
	flag.Parse()

	slog.Info("starting agent", "version", version, "config", *configPath)

	cfg, err := config.LoadAgentConfig(*configPath)
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
}
