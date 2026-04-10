// Package main is the entry point for the sc-scan CLI.
package main

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/securitycentral/sc-scan/internal/config"
	"github.com/securitycentral/sc-scan/internal/output"
	"github.com/securitycentral/sc-scan/internal/scanner/configs"
	"github.com/securitycentral/sc-scan/internal/scanner/deps"
	"github.com/securitycentral/sc-scan/internal/scanner/patterns"
	"github.com/securitycentral/sc-scan/internal/scanner/secrets"
	"github.com/securitycentral/sc-scan/pkg/models"
)

func main() {
	var repoDir string
	var changedFilesStr string
	var scanType string
	var outputFormat string
	var failOn string

	rootCmd := &cobra.Command{
		Use:   "sc-scan",
		Short: "SecurityCentral code scanner",
		Long:  "Scans a local repository for security issues and outputs JSON findings.",
		RunE: func(cmd *cobra.Command, args []string) error {
			return runScan(repoDir, changedFilesStr, scanType, outputFormat, failOn)
		},
	}

	rootCmd.Flags().StringVar(&repoDir, "repo-dir", "", "Path to cloned repository (required)")
	rootCmd.Flags().StringVar(&changedFilesStr, "changed-files", "", "Comma-separated list of changed files (delta mode)")
	rootCmd.Flags().StringVar(&scanType, "scan-type", "full", "Scan type: deps, secrets, configs, patterns, full")
	rootCmd.Flags().StringVar(&outputFormat, "output", "json", "Output format (json)")
	rootCmd.Flags().StringVar(&failOn, "fail-on", "", "Fail with exit code 1 if findings at or above this severity (critical, high, medium, low)")

	_ = rootCmd.MarkFlagRequired("repo-dir")

	if err := rootCmd.Execute(); err != nil {
		os.Exit(2)
	}
}

func runScan(repoDir, changedFilesStr, scanType, outputFormat, failOn string) error {
	start := time.Now()

	// Validate repo-dir exists
	info, err := os.Stat(repoDir)
	if err != nil || !info.IsDir() {
		result := models.ScanResult{
			ScanType: scanType,
			Error:    fmt.Sprintf("repo-dir does not exist or is not a directory: %s", repoDir),
		}
		_ = output.WriteJSON(os.Stdout, result)
		os.Exit(2)
		return nil
	}

	// Parse changed files
	var changedFiles []string
	if changedFilesStr != "" {
		for _, f := range strings.Split(changedFilesStr, ",") {
			trimmed := strings.TrimSpace(f)
			if trimmed != "" {
				changedFiles = append(changedFiles, trimmed)
			}
		}
	}

	// Load .securitycentral.yml config
	cfg, err := config.LoadConfigFile(repoDir)
	if err != nil {
		result := models.ScanResult{
			ScanType: scanType,
			Error:    fmt.Sprintf("failed to load config: %v", err),
		}
		_ = output.WriteJSON(os.Stdout, result)
		os.Exit(2)
		return nil
	}

	var allFindings []models.Finding
	totalFiles := 0

	// Run selected scan types
	shouldRunDeps := scanType == "full" || scanType == "deps"
	shouldRunSecrets := scanType == "full" || scanType == "secrets"
	shouldRunConfigs := scanType == "full" || scanType == "configs"
	shouldRunPatterns := scanType == "full" || scanType == "patterns"

	if shouldRunDeps {
		findings, filesCount, err := deps.Scan(repoDir, cfg.Deps, changedFiles)
		if err != nil {
			result := models.ScanResult{
				ScanType: scanType,
				Error:    fmt.Sprintf("dependency scan failed: %v", err),
				Duration: time.Since(start).Milliseconds(),
			}
			_ = output.WriteJSON(os.Stdout, result)
			os.Exit(2)
			return nil
		}
		allFindings = append(allFindings, findings...)
		totalFiles += filesCount
	}

	if shouldRunSecrets {
		findings, filesCount, err := secrets.Scan(repoDir, cfg.Secrets, changedFiles)
		if err != nil {
			result := models.ScanResult{
				ScanType: scanType,
				Error:    fmt.Sprintf("secrets scan failed: %v", err),
				Duration: time.Since(start).Milliseconds(),
			}
			_ = output.WriteJSON(os.Stdout, result)
			os.Exit(2)
			return nil
		}
		allFindings = append(allFindings, findings...)
		totalFiles += filesCount
	}

	if shouldRunConfigs {
		findings, filesCount, err := configs.Scan(repoDir, changedFiles)
		if err != nil {
			result := models.ScanResult{
				ScanType: scanType,
				Error:    fmt.Sprintf("config scan failed: %v", err),
				Duration: time.Since(start).Milliseconds(),
			}
			_ = output.WriteJSON(os.Stdout, result)
			os.Exit(2)
			return nil
		}
		allFindings = append(allFindings, findings...)
		totalFiles += filesCount
	}

	if shouldRunPatterns {
		findings, filesCount, err := patterns.Scan(repoDir, changedFiles)
		if err != nil {
			result := models.ScanResult{
				ScanType: scanType,
				Error:    fmt.Sprintf("pattern scan failed: %v", err),
				Duration: time.Since(start).Milliseconds(),
			}
			_ = output.WriteJSON(os.Stdout, result)
			os.Exit(2)
			return nil
		}
		allFindings = append(allFindings, findings...)
		totalFiles += filesCount
	}

	// Build result
	result := models.ScanResult{
		ScanType:     scanType,
		Findings:     allFindings,
		Duration:     time.Since(start).Milliseconds(),
		FilesScanned: totalFiles,
	}

	if err := output.WriteJSON(os.Stdout, result); err != nil {
		fmt.Fprintf(os.Stderr, "failed to write output: %v\n", err)
		os.Exit(2)
	}

	// Exit code based on findings threshold
	exitCode := output.ExitCode(allFindings, failOn)
	if exitCode != 0 {
		os.Exit(exitCode)
	}

	return nil
}
