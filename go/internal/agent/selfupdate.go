package agent

import (
	"crypto/ed25519"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"runtime"
)

// SelfUpdater handles agent binary self-updates.
type SelfUpdater struct {
	client    *http.Client
	publicKey ed25519.PublicKey // ed25519 public key for signature verification
}

// NewSelfUpdater creates a self-updater with the given signature verification key.
func NewSelfUpdater(client *http.Client, publicKey ed25519.PublicKey) *SelfUpdater {
	return &SelfUpdater{client: client, publicKey: publicKey}
}

// Update downloads a new agent binary, verifies its signature, and restarts.
func (u *SelfUpdater) Update(downloadURL string) error {
	slog.Info("downloading agent update", "url", downloadURL)

	// Download binary
	resp, err := u.client.Get(downloadURL)
	if err != nil {
		return fmt.Errorf("download agent: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download failed: HTTP %d", resp.StatusCode)
	}

	tmpPath := os.TempDir() + "/sc-agent-update"
	tmpFile, err := os.Create(tmpPath)
	if err != nil {
		return fmt.Errorf("create temp file: %w", err)
	}

	if _, err := io.Copy(tmpFile, resp.Body); err != nil {
		tmpFile.Close()
		return fmt.Errorf("write binary: %w", err)
	}
	tmpFile.Close()

	// Download and verify signature
	sigResp, err := u.client.Get(downloadURL + ".sig")
	if err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("download signature: %w", err)
	}
	defer sigResp.Body.Close()

	if sigResp.StatusCode == http.StatusOK {
		signature, err := io.ReadAll(sigResp.Body)
		if err != nil {
			os.Remove(tmpPath)
			return fmt.Errorf("read signature: %w", err)
		}

		binaryData, err := os.ReadFile(tmpPath)
		if err != nil {
			os.Remove(tmpPath)
			return fmt.Errorf("read binary for verification: %w", err)
		}

		if u.publicKey != nil && !ed25519.Verify(u.publicKey, binaryData, signature) {
			os.Remove(tmpPath)
			return fmt.Errorf("signature verification failed")
		}
		slog.Info("binary signature verified")
	} else {
		slog.Warn("signature not available, skipping verification")
	}

	// Replace binary
	currentBin, err := os.Executable()
	if err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("determine current binary path: %w", err)
	}

	if err := os.Chmod(tmpPath, 0755); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("chmod: %w", err)
	}

	// Atomic replace: rename temp to current
	backupPath := currentBin + ".bak"
	os.Rename(currentBin, backupPath) // backup current
	if err := os.Rename(tmpPath, currentBin); err != nil {
		// Restore backup on failure
		os.Rename(backupPath, currentBin)
		return fmt.Errorf("replace binary: %w", err)
	}

	slog.Info("agent binary updated, restarting service")
	return restartService()
}

func restartService() error {
	if runtime.GOOS != "linux" {
		slog.Warn("self-restart only supported on Linux")
		return nil
	}

	cmd := exec.Command("systemctl", "restart", "securitycentral-agent.service")
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("restart service: %w", err)
	}
	return nil
}
