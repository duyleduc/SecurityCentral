package agent

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"

	"github.com/security-central/security-central/internal/signing"
)

// SelfUpdater handles agent binary self-updates with mandatory signature
// verification. The Ed25519 public key is embedded at build time.
type SelfUpdater struct {
	client  *http.Client
	baseURL string // e.g. "https://sc-api-xxx.run.app"
}

// NewSelfUpdater creates a self-updater that downloads from the given API base URL.
func NewSelfUpdater(client *http.Client, baseURL string) *SelfUpdater {
	return &SelfUpdater{client: client, baseURL: strings.TrimRight(baseURL, "/")}
}

// Update downloads the latest binary, verifies its signature, replaces the
// current binary, and restarts the systemd service.
//
// It checks the remote version first and refuses to downgrade unless force is
// true. Signature verification is mandatory for signed builds.
func (u *SelfUpdater) Update(arch, currentVersion string, force bool) error {
	// 0. Check version — refuse if current >= latest (unless --force)
	latestVersion, err := u.fetchLatestVersion()
	if err != nil {
		slog.Warn("could not fetch latest version, proceeding anyway", "error", err)
	} else {
		slog.Info("version check", "current", currentVersion, "latest", latestVersion)

		cmp := compareSemver(currentVersion, latestVersion)
		if cmp == 0 && !force {
			return fmt.Errorf("already up to date (v%s)", currentVersion)
		}
		if cmp > 0 && !force {
			return fmt.Errorf("downgrade not allowed: current v%s > remote v%s (use --force to override)", currentVersion, latestVersion)
		}
		if force && cmp >= 0 {
			slog.Warn("forcing update", "current", currentVersion, "latest", latestVersion)
		}
	}

	pubKey := signing.PublicKey()
	if pubKey == nil {
		slog.Warn("no signing public key embedded — this is an unsigned dev build, skipping verification")
	} else {
		slog.Info("signature verification enabled")
	}

	// 1. Download binary
	binaryURL := fmt.Sprintf("%s/v1/agents/download?arch=%s", u.baseURL, arch)
	slog.Info("downloading agent binary", "url", binaryURL)

	tmpPath, err := downloadToTemp(u.client, binaryURL)
	if err != nil {
		return fmt.Errorf("download binary: %w", err)
	}
	defer func() { os.Remove(tmpPath) }() // cleanup on any failure path

	// 2. Verify signature (mandatory for signed builds)
	if pubKey != nil {
		if err := u.verifyDownload(tmpPath, arch, pubKey); err != nil {
			return fmt.Errorf("verification failed — update aborted: %w", err)
		}
		slog.Info("binary signature verified")
	}

	// 3. Replace binary
	currentBin, err := os.Executable()
	if err != nil {
		return fmt.Errorf("determine current binary path: %w", err)
	}

	if err := os.Chmod(tmpPath, 0755); err != nil {
		return fmt.Errorf("chmod: %w", err)
	}

	backupPath := currentBin + ".bak"
	_ = os.Rename(currentBin, backupPath) // backup current (best-effort)

	if err := os.Rename(tmpPath, currentBin); err != nil {
		// Restore backup on failure
		_ = os.Rename(backupPath, currentBin)
		return fmt.Errorf("replace binary: %w", err)
	}

	// Write rollback marker before restarting
	if err := WriteUpdateMarker(currentBin, backupPath, ""); err != nil {
		slog.Warn("failed to write update marker (rollback won't work)", "error", err)
	}

	slog.Info("agent binary updated, restarting service")
	return restartService()
}

// verifyDownload checks the SHA-256 checksum and Ed25519 signature of the
// downloaded binary against the platform API.
func (u *SelfUpdater) verifyDownload(binaryPath, arch string, pubKey ed25519.PublicKey) error {
	// Compute SHA-256 of the downloaded binary
	binaryData, err := os.ReadFile(binaryPath)
	if err != nil {
		return fmt.Errorf("read downloaded binary: %w", err)
	}
	actualChecksum := sha256.Sum256(binaryData)

	// Download and verify .sha256
	checksumURL := fmt.Sprintf("%s/v1/agents/download/checksum?arch=%s", u.baseURL, arch)
	checksumBody, err := httpGetBody(u.client, checksumURL)
	if err != nil {
		return fmt.Errorf("download checksum: %w", err)
	}

	expectedHex := parseChecksumHex(checksumBody)
	actualHex := hex.EncodeToString(actualChecksum[:])
	if actualHex != expectedHex {
		return fmt.Errorf("SHA-256 mismatch: expected %s, got %s", expectedHex, actualHex)
	}

	// Download and verify .sig
	sigURL := fmt.Sprintf("%s/v1/agents/download/signature?arch=%s", u.baseURL, arch)
	signature, err := httpGetBody(u.client, sigURL)
	if err != nil {
		return fmt.Errorf("download signature: %w", err)
	}

	// Ed25519 signs the raw checksum bytes (32 bytes), not the hex string
	if !ed25519.Verify(pubKey, actualChecksum[:], signature) {
		return fmt.Errorf("Ed25519 signature verification failed")
	}

	return nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func downloadToTemp(client *http.Client, url string) (string, error) {
	resp, err := client.Get(url)
	if err != nil {
		return "", fmt.Errorf("GET %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("GET %s: HTTP %d", url, resp.StatusCode)
	}

	tmpFile, err := os.CreateTemp("", "sc-agent-update-*")
	if err != nil {
		return "", fmt.Errorf("create temp file: %w", err)
	}

	if _, err := io.Copy(tmpFile, resp.Body); err != nil {
		tmpFile.Close()
		os.Remove(tmpFile.Name())
		return "", fmt.Errorf("write binary: %w", err)
	}
	tmpFile.Close()

	return tmpFile.Name(), nil
}

func httpGetBody(client *http.Client, url string) ([]byte, error) {
	resp, err := client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("GET %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("not found: %s (unsigned build on server?)", url)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d from %s", resp.StatusCode, url)
	}

	return io.ReadAll(resp.Body)
}

func parseChecksumHex(data []byte) string {
	s := strings.TrimSpace(string(data))
	// Format: "hexhash  filename" — extract just the hash
	if idx := strings.IndexByte(s, ' '); idx > 0 {
		return s[:idx]
	}
	return s
}

// fetchLatestVersion queries GET /v1/agents/version and returns the version string.
func (u *SelfUpdater) fetchLatestVersion() (string, error) {
	url := fmt.Sprintf("%s/v1/agents/version", u.baseURL)
	body, err := httpGetBody(u.client, url)
	if err != nil {
		return "", err
	}

	var resp struct {
		Data struct {
			Version string `json:"version"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return "", fmt.Errorf("parse version response: %w", err)
	}
	if resp.Data.Version == "" {
		return "", fmt.Errorf("empty version in response")
	}
	return resp.Data.Version, nil
}

// compareSemver compares two semver strings (major.minor.patch).
// Returns -1 if a < b, 0 if a == b, 1 if a > b.
// Non-numeric or malformed versions are treated as 0.0.0.
func compareSemver(a, b string) int {
	ap := parseSemver(a)
	bp := parseSemver(b)
	for i := 0; i < 3; i++ {
		if ap[i] < bp[i] {
			return -1
		}
		if ap[i] > bp[i] {
			return 1
		}
	}
	return 0
}

func parseSemver(s string) [3]int {
	s = strings.TrimPrefix(s, "v")
	parts := strings.SplitN(s, ".", 3)
	var result [3]int
	for i := 0; i < 3 && i < len(parts); i++ {
		// Strip pre-release suffix (e.g., "1-beta")
		clean := parts[i]
		if idx := strings.IndexByte(clean, '-'); idx >= 0 {
			clean = clean[:idx]
		}
		result[i], _ = strconv.Atoi(clean)
	}
	return result
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
