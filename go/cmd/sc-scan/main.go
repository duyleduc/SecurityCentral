// sc-scan is the SecurityCentral Code Scanner CLI.
// It scans dependencies and source code for vulnerabilities and secrets.
package main

import (
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/spf13/cobra"

	"github.com/security-central/security-central/internal/config"
	"github.com/security-central/security-central/internal/logging"
	"github.com/security-central/security-central/internal/output"
	"github.com/security-central/security-central/internal/platform"
	"github.com/security-central/security-central/internal/scanner/deps"
	"github.com/security-central/security-central/internal/scanner/secrets"
	"github.com/security-central/security-central/pkg/models"
)

var version = "dev"

func main() {
	logging.Init("sc-scan")

	var cliCfg config.ScanConfig

	rootCmd := &cobra.Command{
		Use:     "sc-scan",
		Short:   "SecurityCentral Code Scanner",
		Version: version,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runScan(cliCfg)
		},
	}

	flags := rootCmd.Flags()
	flags.StringVar(&cliCfg.Path, "path", ".", "Path to repository root")
	flags.StringVar(&cliCfg.APIKey, "api-key", os.Getenv("SC_API_KEY"), "SecurityCentral API key")
	flags.StringVar(&cliCfg.APIURL, "api-url", "https://api.securitycentral.io", "Platform API URL")
	flags.BoolVar(&cliCfg.ScanDeps, "scan-deps", true, "Enable dependency scanning")
	flags.BoolVar(&cliCfg.ScanSecrets, "scan-secrets", true, "Enable secrets scanning")
	flags.StringVar(&cliCfg.Output, "output", "table", "Output format: table | json | sarif")
	flags.StringVar(&cliCfg.OutputFile, "output-file", "", "Write results to file")
	flags.StringVar(&cliCfg.FailOn, "fail-on", "", "Exit non-zero if findings at or above severity")
	flags.BoolVar(&cliCfg.Incremental, "incremental", false, "Only scan changed files")
	flags.BoolVar(&cliCfg.NoUpload, "no-upload", false, "Do not upload results to platform")
	flags.BoolVar(&cliCfg.Verbose, "verbose", false, "Verbose logging")

	if err := rootCmd.Execute(); err != nil {
		os.Exit(2)
	}
}

func runScan(cliCfg config.ScanConfig) error {
	startTime := time.Now()

	// Load config file and merge with CLI flags
	fileCfg, err := config.LoadConfigFile(cliCfg.Path)
	if err != nil {
		slog.Error("failed to load config file", "error", err)
		os.Exit(2)
	}
	fileCfg.Merge(cliCfg)
	cfg := fileCfg

	if cfg.Verbose {
		slog.SetLogLoggerLevel(slog.LevelDebug)
	}

	slog.Info("starting scan", "path", cfg.Path, "deps", cfg.ScanDeps, "secrets", cfg.ScanSecrets)

	var allFindings []models.Finding

	// Dependency scanning
	if cfg.ScanDeps {
		slog.Info("running dependency scan")
		depFindings, err := deps.Scan(cfg.Path, cfg.Deps, cfg.Incremental)
		if err != nil {
			slog.Error("dependency scan failed", "error", err)
			os.Exit(2)
		}
		allFindings = append(allFindings, depFindings...)
		slog.Info("dependency scan complete", "findings", len(depFindings))
	}

	// Secrets scanning
	if cfg.ScanSecrets {
		slog.Info("running secrets scan")
		secretFindings, err := secrets.Scan(cfg.Path, cfg.Secrets, cfg.Incremental)
		if err != nil {
			slog.Error("secrets scan failed", "error", err)
			os.Exit(2)
		}
		allFindings = append(allFindings, secretFindings...)
		slog.Info("secrets scan complete", "findings", len(secretFindings))
	}

	duration := time.Since(startTime)
	slog.Info("scan complete", "total_findings", len(allFindings), "duration_ms", duration.Milliseconds())

	// Output results
	var w *os.File
	if cfg.OutputFile != "" {
		w, err = os.Create(cfg.OutputFile)
		if err != nil {
			return fmt.Errorf("failed to create output file: %w", err)
		}
		defer w.Close()
	} else {
		w = os.Stdout
	}

	if err := output.Format(w, cfg.Output, allFindings); err != nil {
		return fmt.Errorf("failed to format output: %w", err)
	}

	// Upload to platform
	if !cfg.NoUpload && cfg.APIKey != "" {
		slog.Info("uploading results to platform")
		client := platform.New(cfg.APIURL, cfg.APIKey)
		_ = client // TODO: implement upload in platform client
	}

	// Exit code
	exitCode := output.ExitCode(allFindings, cfg.FailOn)
	if exitCode != 0 {
		os.Exit(exitCode)
	}

	return nil
}
