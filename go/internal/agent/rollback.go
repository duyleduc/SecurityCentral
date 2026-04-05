package agent

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"runtime"
	"time"
)

const (
	updateMarkerPath   = "/var/lib/securitycentral/.update-pending"
	rollbackTimeout    = 2 * time.Minute
)

// UpdateMarker is written before restarting after an update.
type UpdateMarker struct {
	BackupPath string    `json:"backupPath"`
	BinaryPath string    `json:"binaryPath"`
	Timestamp  time.Time `json:"timestamp"`
	Version    string    `json:"version"`
}

// WriteUpdateMarker creates the marker file before restarting the service
// after a binary update. The watchdog reads this on next startup.
func WriteUpdateMarker(binaryPath, backupPath, version string) error {
	marker := UpdateMarker{
		BackupPath: backupPath,
		BinaryPath: binaryPath,
		Timestamp:  time.Now(),
		Version:    version,
	}
	data, err := json.Marshal(marker)
	if err != nil {
		return fmt.Errorf("marshal update marker: %w", err)
	}
	return os.WriteFile(updateMarkerPath, data, 0644)
}

// ClearUpdateMarker removes the marker file after a successful heartbeat
// confirms the new binary is working.
func ClearUpdateMarker() {
	if err := os.Remove(updateMarkerPath); err != nil && !os.IsNotExist(err) {
		slog.Warn("failed to remove update marker", "error", err)
	}
}

// StartRollbackWatchdog checks for an update marker and starts a timer.
// If the timer expires (no call to ConfirmUpdate), it restores the backup
// binary and restarts the service.
//
// Returns a confirm function that must be called after the first successful
// heartbeat. Returns nil if no marker exists (normal startup).
func StartRollbackWatchdog() func() {
	data, err := os.ReadFile(updateMarkerPath)
	if err != nil {
		return nil // No marker = normal startup
	}

	var marker UpdateMarker
	if err := json.Unmarshal(data, &marker); err != nil {
		slog.Warn("invalid update marker, removing", "error", err)
		ClearUpdateMarker()
		return nil
	}

	// If marker is already older than the timeout, rollback immediately
	if time.Since(marker.Timestamp) > rollbackTimeout {
		slog.Error("update marker expired — rolling back immediately",
			"marker_age", time.Since(marker.Timestamp),
			"backup", marker.BackupPath,
		)
		performRollback(marker)
		return nil
	}

	slog.Warn("update pending — watchdog started",
		"backup", marker.BackupPath,
		"timeout", rollbackTimeout,
		"version", marker.Version,
	)

	confirmed := make(chan struct{}, 1)

	go func() {
		remaining := rollbackTimeout - time.Since(marker.Timestamp)
		timer := time.NewTimer(remaining)
		defer timer.Stop()

		select {
		case <-confirmed:
			slog.Info("update confirmed — watchdog cancelled")
			ClearUpdateMarker()
		case <-timer.C:
			slog.Error("update watchdog expired — no successful heartbeat, rolling back",
				"backup", marker.BackupPath,
			)
			performRollback(marker)
		}
	}()

	return func() {
		select {
		case confirmed <- struct{}{}:
		default:
		}
	}
}

func performRollback(marker UpdateMarker) {
	// Restore backup
	if err := os.Rename(marker.BackupPath, marker.BinaryPath); err != nil {
		slog.Error("CRITICAL: rollback failed — cannot restore backup",
			"error", err,
			"backup", marker.BackupPath,
			"target", marker.BinaryPath,
		)
		ClearUpdateMarker()
		return
	}

	slog.Info("backup restored", "path", marker.BinaryPath)
	ClearUpdateMarker()

	// Restart service
	if runtime.GOOS == "linux" {
		cmd := exec.Command("systemctl", "restart", "securitycentral-agent.service")
		if err := cmd.Run(); err != nil {
			slog.Error("failed to restart after rollback", "error", err)
		}
	}
}
