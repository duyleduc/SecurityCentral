package install

import (
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"strings"
)

// Paths to remove during uninstall (same as install.go constants).
var uninstallPaths = []string{
	"/etc/systemd/system/securitycentral-agent.service",
	"/usr/local/bin/sc-agent",
	"/usr/local/bin/sc-agent.bak",
	"/etc/securitycentral",
	"/var/lib/securitycentral",
}

// DryRunUninstall prints what would be removed without actually removing anything.
func DryRunUninstall() {
	fmt.Println("The following will be removed:")
	fmt.Println()
	for _, p := range uninstallPaths {
		if info, err := os.Stat(p); err == nil {
			if info.IsDir() {
				fmt.Printf("  [dir]  %s\n", p)
			} else {
				fmt.Printf("  [file] %s\n", p)
			}
		} else {
			fmt.Printf("  [skip] %s (not found)\n", p)
		}
	}
	fmt.Println()
	fmt.Println("Services to stop:")
	fmt.Println("  securitycentral-agent.service")
	fmt.Println()
	fmt.Println("Run with --confirm to proceed.")
}

// Uninstall removes the agent from the system. It stops the service,
// removes all files, and reloads systemd.
func Uninstall(apiURL, agentID string) error {
	slog.Info("uninstalling securitycentral agent")

	// 1. Stop and disable systemd service
	slog.Info("stopping service")
	for _, args := range [][]string{
		{"systemctl", "stop", "securitycentral-agent.service"},
		{"systemctl", "disable", "securitycentral-agent.service"},
	} {
		cmd := exec.Command(args[0], args[1:]...)
		if err := cmd.Run(); err != nil {
			slog.Warn("systemctl command failed (may already be stopped)", "cmd", strings.Join(args, " "), "error", err)
		}
	}

	// 2. Notify platform (best-effort)
	if apiURL != "" && agentID != "" {
		notifyDecommission(apiURL, agentID)
	}

	// 3. Remove files
	for _, p := range uninstallPaths {
		if err := os.RemoveAll(p); err != nil {
			slog.Warn("failed to remove", "path", p, "error", err)
		} else {
			slog.Info("removed", "path", p)
		}
	}

	// 4. Reload systemd
	cmd := exec.Command("systemctl", "daemon-reload")
	if err := cmd.Run(); err != nil {
		slog.Warn("daemon-reload failed", "error", err)
	}

	fmt.Println()
	fmt.Println("SecurityCentral Agent uninstalled.")
	return nil
}

// notifyDecommission tells the platform this agent is decommissioned.
// Best-effort — failure doesn't block uninstall.
func notifyDecommission(apiURL, agentID string) {
	// The agent sends a final heartbeat-like signal. For now we just log it.
	// In the future this could POST to /v1/agents/decommission.
	slog.Info("notifying platform of decommission", "agent_id", agentID, "api_url", apiURL)
}
