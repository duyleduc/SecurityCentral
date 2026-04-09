package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"

	"github.com/securitycentral/sc-agent/internal/agent"
	"github.com/securitycentral/sc-agent/internal/config"
	"github.com/securitycentral/sc-agent/internal/logging"
	"github.com/securitycentral/sc-agent/internal/platform"
	"github.com/securitycentral/sc-agent/internal/sysinfo"
)

const version = "0.1.0"

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
		Short: "Register this agent with the platform using an install token",
		RunE: func(cmd *cobra.Command, args []string) error {
			if token == "" {
				return fmt.Errorf("--token is required")
			}

			log := logging.New(logging.LevelInfo)
			sys := sysinfo.GetSystemInfo()

			if apiURL == "" {
				apiURL = "http://localhost:3000"
			}

			client := platform.NewClient(apiURL, "")
			resp, err := client.Register(platform.RegisterRequest{
				Token:        token,
				Hostname:     sys.Hostname,
				OSFamily:     sys.OS,
				OSVersion:    sys.Version,
				AgentVersion: version,
			})
			if err != nil {
				return fmt.Errorf("registration failed: %w", err)
			}

			cfg := config.DefaultConfig()
			cfg.APIBaseURL = apiURL
			cfg.AgentID = resp.AgentID
			cfg.APIKey = resp.APIKey

			if err := os.MkdirAll("/etc/securitycentral", 0755); err != nil {
				// Try local dir as fallback
				configPath = "./agent.json"
			}

			if err := cfg.SaveToFile(configPath); err != nil {
				return fmt.Errorf("save config: %w", err)
			}

			log.Info("agent registered", map[string]interface{}{
				"serverId": resp.ServerID,
				"agentId":  resp.AgentID,
				"config":   configPath,
			})

			fmt.Printf("Agent registered successfully!\n")
			fmt.Printf("  Server ID: %s\n", resp.ServerID)
			fmt.Printf("  Agent ID:  %s\n", resp.AgentID)
			fmt.Printf("  Config:    %s\n", configPath)
			fmt.Printf("\nStart the agent with: sc-agent run\n")

			return nil
		},
	}

	cmd.Flags().StringVar(&token, "token", "", "install token from the platform")
	cmd.Flags().StringVar(&apiURL, "api-url", "http://localhost:3000", "platform API base URL")

	return cmd
}

func statusCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show agent status and last heartbeat info",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := config.LoadFromFile(configPath)
			if err != nil {
				fmt.Println("Agent not configured. Run 'sc-agent install --token <TOKEN>' first.")
				return nil
			}

			fmt.Printf("Agent Status\n")
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
