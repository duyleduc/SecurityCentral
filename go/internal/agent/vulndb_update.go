package agent

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
)

const defaultVulnDBPath = "/var/lib/securitycentral/vulndb.json"

// VulnDBUpdater handles vulnerability database updates from the platform.
type VulnDBUpdater struct {
	client  *http.Client
	baseURL string
	dbPath  string
}

// NewVulnDBUpdater creates a new updater.
func NewVulnDBUpdater(client *http.Client, baseURL, dbPath string) *VulnDBUpdater {
	if dbPath == "" {
		dbPath = defaultVulnDBPath
	}
	return &VulnDBUpdater{client: client, baseURL: baseURL, dbPath: dbPath}
}

// CurrentVersion reads the current local vulndb version from a sidecar file.
func (u *VulnDBUpdater) CurrentVersion() string {
	data, err := os.ReadFile(u.dbPath + ".version")
	if err != nil {
		return ""
	}
	return string(data)
}

// Update fetches the latest vulndb from the platform and applies it locally.
// Uses delta downloads when possible (since= current version timestamp).
func (u *VulnDBUpdater) Update() error {
	currentVersion := u.CurrentVersion()

	url := fmt.Sprintf("%s/v1/agents/vulndb/download", u.baseURL)
	if currentVersion != "" {
		url += "?since=" + currentVersion
	}

	slog.Info("downloading vulndb update", "since", currentVersion)

	resp, err := u.client.Get(url)
	if err != nil {
		return fmt.Errorf("fetch vulndb: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("vulndb download failed: HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read vulndb response: %w", err)
	}

	// Parse response envelope
	var envelope struct {
		Data struct {
			Version string                                    `json:"version"`
			Data    map[string]map[string]json.RawMessage     `json:"data"`
			IsDelta bool                                      `json:"isDelta"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return fmt.Errorf("parse vulndb response: %w", err)
	}

	if envelope.Data.IsDelta {
		return u.applyDelta(envelope.Data.Data, envelope.Data.Version)
	}

	return u.applyFull(envelope.Data.Data, envelope.Data.Version)
}

func (u *VulnDBUpdater) applyFull(data map[string]map[string]json.RawMessage, version string) error {
	slog.Info("applying full vulndb snapshot", "version", version)

	serialized, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("marshal vulndb: %w", err)
	}

	if err := os.MkdirAll(filepath.Dir(u.dbPath), 0750); err != nil {
		return fmt.Errorf("create vulndb dir: %w", err)
	}

	// Atomic write: write to temp, then rename
	tmpPath := u.dbPath + ".tmp"
	if err := os.WriteFile(tmpPath, serialized, 0640); err != nil {
		return fmt.Errorf("write vulndb: %w", err)
	}
	if err := os.Rename(tmpPath, u.dbPath); err != nil {
		return fmt.Errorf("rename vulndb: %w", err)
	}

	// Write version sidecar
	if err := os.WriteFile(u.dbPath+".version", []byte(version), 0640); err != nil {
		return fmt.Errorf("write version: %w", err)
	}

	slog.Info("vulndb updated", "version", version)
	return nil
}

func (u *VulnDBUpdater) applyDelta(delta map[string]map[string]json.RawMessage, version string) error {
	slog.Info("applying vulndb delta", "version", version)

	// Load current DB
	currentData, err := os.ReadFile(u.dbPath)
	if err != nil {
		// No current DB — treat delta as full
		return u.applyFull(delta, version)
	}

	var current map[string]map[string]json.RawMessage
	if err := json.Unmarshal(currentData, &current); err != nil {
		return u.applyFull(delta, version)
	}

	// Merge delta into current
	for bucket, packages := range delta {
		if current[bucket] == nil {
			current[bucket] = make(map[string]json.RawMessage)
		}
		for pkg, entries := range packages {
			current[bucket][pkg] = entries
		}
	}

	return u.applyFull(current, version)
}
