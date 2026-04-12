package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"

	"github.com/securitycentral/sc-agent/internal/agent"
	"github.com/securitycentral/sc-agent/internal/config"
	"github.com/securitycentral/sc-agent/internal/install"
	"github.com/securitycentral/sc-agent/internal/logging"
	"github.com/securitycentral/sc-agent/internal/sysinfo"
	"github.com/securitycentral/sc-agent/internal/updater"
)

// Version is injected at build time via -ldflags:
//
//	go build -ldflags "-X main.version=1.2.3" ./cmd/sc-agent
//
// Falls back to "dev" for local development builds.
var version = "dev"

// GetVersion returns the build-time version string.
// Exported so other packages can access it.
func GetVersion() string { return version }

var configPath string

func main() {
	rootCmd := &cobra.Command{
		Use:     "sc-agent",
		Short:   "SecurityCentral infrastructure monitoring agent",
		Version: version,
	}

	rootCmd.PersistentFlags().StringVar(&configPath, "config", "/etc/securitycentral/agent.json", "config file path")

	rootCmd.AddCommand(runCmd())
	rootCmd.AddCommand(installCmd())
	rootCmd.AddCommand(statusCmd())
	rootCmd.AddCommand(updateCmd())
	rootCmd.AddCommand(uninstallCmd())

	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

func runCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "run",
		Short: "Start the agent with adaptive heartbeat",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := config.LoadFromFile(configPath)
			if err != nil {
				return fmt.Errorf("load config: %w", err)
			}

			if cfg.AgentID == "" || cfg.APIKey == "" {
				return fmt.Errorf("agent not registered — run 'sc-agent install --token <TOKEN>' first")
			}

			log := logging.New(logging.LevelInfo)
			log.Info("starting sc-agent", map[string]interface{}{
				"version": version,
				"agentId": cfg.AgentID,
				"apiUrl":  cfg.APIBaseURL,
			})

			ctx, cancel := agent.WaitForShutdown(log)
			defer cancel()

			agent.Version = version
			a := agent.New(cfg, log)
			a.Run(ctx)

			log.Info("agent stopped")
			return nil
		},
	}
}

func installCmd() *cobra.Command {
	var (
		token  string
		apiURL string
	)

	cmd := &cobra.Command{
		Use:   "install",
		Short: "Register this agent with the platform, install binary, and start systemd service",
		RunE: func(cmd *cobra.Command, args []string) error {
			if token == "" {
				return fmt.Errorf("--token is required")
			}
			if apiURL == "" {
				apiURL = "http://localhost:3000"
			}
			return install.Run(token, apiURL)
		},
	}

	cmd.Flags().StringVar(&token, "token", "", "install token from the platform")
	cmd.Flags().StringVar(&apiURL, "api-url", "http://localhost:3000", "platform API base URL")

	return cmd
}

func statusCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show agent status and current metrics",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := config.LoadFromFile(configPath)
			if err != nil {
				fmt.Println("Agent not configured. Run 'sc-agent install --token <TOKEN>' first.")
				return nil
			}

			fmt.Printf("Agent Status\n")
			fmt.Printf("  Version:   %s\n", version)
			fmt.Printf("  Agent ID:  %s\n", cfg.AgentID)
			fmt.Printf("  API URL:   %s\n", cfg.APIBaseURL)
			fmt.Printf("  Config:    %s\n", configPath)

			m, err := sysinfo.CollectMetrics()
			if err == nil {
				fmt.Printf("\nCurrent Metrics\n")
				fmt.Printf("  CPU:  %.1f%%\n", m.CPUPercent)
				fmt.Printf("  RAM:  %.1f%%\n", m.RAMPercent)
				fmt.Printf("  Disk: %.1f%%\n", m.DiskPercent)
			}

			return nil
		},
	}
}

func updateCmd() *cobra.Command {
	var force bool

	cmd := &cobra.Command{
		Use:   "update",
		Short: "Check for and apply agent updates from the platform",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := config.LoadFromFile(configPath)
			if err != nil {
				return fmt.Errorf("load config: %w", err)
			}
			return updater.Update(cfg.APIBaseURL, version, force)
		},
	}

	cmd.Flags().BoolVarP(&force, "force", "f", false, "force update even if already on latest version")
	return cmd
}

func uninstallCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "uninstall",
		Short: "Stop the agent service, remove binary and config",
		RunE: func(cmd *cobra.Command, args []string) error {
			return updater.Uninstall()
		},
	}
}
