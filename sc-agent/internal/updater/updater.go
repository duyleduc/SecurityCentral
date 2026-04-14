// Package updater handles self-update and uninstall of the sc-agent binary.
//
// Update flow:
//  1. Check platform for latest version via GET /v1/agents/version
//  2. Compare with current version — skip if already latest (unless --force)
//  3. Download new binary from GET /v1/agents/download?arch=<arch>
//  4. Replace /usr/local/bin/sc-agent atomically (write tmp + rename)
//  5. Restart systemd service
package updater

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

const (
	binaryPath = "/usr/local/bin/sc-agent"
	unitName   = "sc-agent"
	configDir  = "/etc/securitycentral"
	unitFile   = "/etc/systemd/system/sc-agent.service"
)

// VersionInfo is returned by GET /v1/agents/version.
type VersionInfo struct {
	Version   string `json:"version"`
	Changelog string `json:"changelog"`
}

// Update checks for a new agent version and applies it.
func Update(apiBaseURL, currentVersion string, force bool) error {
	fmt.Printf("Current version: %s\n", currentVersion)

	// 1. Check latest version from platform.
	latest, err := checkLatestVersion(apiBaseURL)
	if err != nil {
		return fmt.Errorf("check version: %w", err)
	}

	fmt.Printf("Latest version:  %s\n", latest.Version)

	if !force && latest.Version == currentVersion {
		fmt.Println("Already up to date.")
		return nil
	}

	if latest.Changelog != "" {
		fmt.Printf("\nChangelog:\n%s\n\n", latest.Changelog)
	}

	// 2. Download new binary.
	arch := runtime.GOARCH
	fmt.Printf("Downloading sc-agent %s (%s)...\n", latest.Version, arch)

	tmpPath := binaryPath + ".update"
	if err := downloadBinary(apiBaseURL, arch, tmpPath); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("download: %w", err)
	}

	// 3. Make executable.
	if err := os.Chmod(tmpPath, 0755); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("chmod: %w", err)
	}

	// 4. Verify the new binary runs.
	out, err := exec.Command(tmpPath, "--version").CombinedOutput()
	if err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("new binary verification failed: %w\nOutput: %s", err, string(out))
	}
	fmt.Printf("Verified: %s", string(out))

	// 5. Atomic replace: rename over the old binary.
	if err := os.Rename(tmpPath, binaryPath); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("replace binary: %w", err)
	}

	// 6. Restart the systemd service.
	fmt.Println("Restarting agent service...")
	if err := exec.Command("systemctl", "restart", unitName).Run(); err != nil {
		fmt.Printf("Warning: could not restart service: %v\n", err)
		fmt.Println("Please restart manually: sudo systemctl restart", unitName)
		return nil
	}

	fmt.Printf("Updated to %s and restarted.\n", latest.Version)
	return nil
}

// Uninstall stops the service, removes the binary, config, and systemd unit.
func Uninstall() error {
	fmt.Println("Stopping agent service...")
	_ = exec.Command("systemctl", "stop", unitName).Run()
	_ = exec.Command("systemctl", "disable", unitName).Run()

	fmt.Println("Removing systemd unit...")
	os.Remove(unitFile)
	_ = exec.Command("systemctl", "daemon-reload").Run()

	fmt.Println("Removing binary...")
	os.Remove(binaryPath)

	fmt.Println("Removing config...")
	os.RemoveAll(configDir)

	fmt.Println("Agent uninstalled.")
	return nil
}

// --- helpers ---

func checkLatestVersion(apiBaseURL string) (*VersionInfo, error) {
	url := strings.TrimRight(apiBaseURL, "/") + "/v1/agents/version"
	client := &http.Client{Timeout: 10 * time.Second}

	resp, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("server returned %d: %s", resp.StatusCode, string(body))
	}

	var envelope struct {
		Data VersionInfo `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		return nil, fmt.Errorf("parse response: %w", err)
	}
	return &envelope.Data, nil
}

func downloadBinary(apiBaseURL, arch, destPath string) error {
	url := fmt.Sprintf("%s/v1/agents/download?arch=%s", strings.TrimRight(apiBaseURL, "/"), arch)
	client := &http.Client{Timeout: 5 * time.Minute}

	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("download failed (%d): %s", resp.StatusCode, string(body))
	}

	f, err := os.Create(destPath)
	if err != nil {
		return fmt.Errorf("create file: %w", err)
	}
	defer f.Close()

	n, err := io.Copy(f, resp.Body)
	if err != nil {
		return fmt.Errorf("write file: %w", err)
	}

	fmt.Printf("Downloaded %d bytes.\n", n)
	return nil
}
