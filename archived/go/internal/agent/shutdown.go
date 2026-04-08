package agent

import (
	"log/slog"
	"os"
	"os/exec"
	"runtime"
)

// Shutdown gracefully stops the agent. Called when the server receives a
// 'shutdown' command from the platform (server decommissioned).
//
// On Linux, it stops and disables the systemd service so it won't restart.
// On other platforms, it simply exits.
func Shutdown(reason string) {
	slog.Warn("shutdown requested by platform", "reason", reason)

	if runtime.GOOS == "linux" {
		slog.Info("disabling systemd service to prevent restart")
		cmd := exec.Command("systemctl", "disable", "--now", "securitycentral-agent.service")
		if err := cmd.Run(); err != nil {
			slog.Error("failed to disable service", "error", err)
		}
	}

	slog.Info("agent shutting down")
	os.Exit(0)
}
