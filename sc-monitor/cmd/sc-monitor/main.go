package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/spf13/cobra"

	"github.com/securitycentral/sc-monitor/internal/config"
	"github.com/securitycentral/sc-monitor/internal/poller"
)

func main() {
	var cfg config.Config
	var pollStr string

	rootCmd := &cobra.Command{
		Use:   "sc-monitor",
		Short: "SecurityCentral uptime monitor — checks website health and reports to platform",
		RunE: func(cmd *cobra.Command, args []string) error {
			d, err := time.ParseDuration(pollStr)
			if err != nil {
				return err
			}
			cfg.PollInterval = d

			if cfg.Verbose {
				slog.SetLogLoggerLevel(slog.LevelDebug)
			}

			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()

			// Graceful shutdown
			sigCh := make(chan os.Signal, 1)
			signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
			go func() {
				<-sigCh
				slog.Info("shutdown signal received")
				cancel()
			}()

			return poller.Run(ctx, cfg)
		},
	}

	f := rootCmd.Flags()
	f.StringVar(&cfg.APIURL, "api-url", envOrDefault("SC_API_URL", "http://localhost:3000"), "Platform API URL")
	f.StringVar(&cfg.APIKey, "api-key", envOrDefault("SC_API_KEY", "sc-monitor-dev-key"), "API key for monitor auth")
	f.StringVar(&pollStr, "poll-interval", envOrDefault("SC_POLL_INTERVAL", "5s"), "How often to poll for due endpoints")
	f.IntVar(&cfg.Concurrency, "concurrency", 50, "Max concurrent checks")
	f.BoolVar(&cfg.Verbose, "verbose", false, "Verbose logging")

	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
