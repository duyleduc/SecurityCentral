// Package agent implements the infrastructure agent's core lifecycle.
package agent

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/security-central/security-central/internal/sysinfo"
)

// HeartbeatPayload is sent to the platform every heartbeat interval.
type HeartbeatPayload struct {
	AgentVersion  string                 `json:"agentVersion"`
	Hostname      string                 `json:"hostname,omitempty"`
	OSFamily      string                 `json:"osFamily,omitempty"`
	OSVersion     string                 `json:"osVersion,omitempty"`
	ResourceUsage *sysinfo.ResourceUsage `json:"resourceUsage,omitempty"`
	SystemInfo    *sysinfo.SystemInfo    `json:"systemInfo,omitempty"`
}

// HeartbeatResponse from the platform.
type HeartbeatResponse struct {
	Data struct {
		Commands []Command     `json:"commands"`
		Config   *ServerConfig `json:"config,omitempty"`
	} `json:"data"`
}

// Command is an instruction from the platform.
type Command struct {
	Type    string         `json:"type"` // scan_now | update_vulndb
	Payload map[string]any `json:"payload,omitempty"`
}

// ConfigUpdate is sent on the configCh when the server delivers new config.
type ConfigUpdate struct {
	Config ServerConfig
}

// HeartbeatLoop sends heartbeats at the configured interval, processes
// commands, and delivers server-managed config updates.
//
// The interval starts at defaultInterval (60s) and is dynamically adjusted
// when the server sends a different heartbeat.interval in the config.
func HeartbeatLoop(client *http.Client, baseURL, agentID, version string, cmdCh chan<- Command, configCh chan<- ConfigUpdate) {
	sys := sysinfo.Collect()
	interval := 60 * time.Second
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		newInterval := sendHeartbeat(client, baseURL, agentID, version, &sys, cmdCh, configCh)
		if newInterval > 0 && newInterval != interval {
			slog.Info("heartbeat interval changed", "old", interval, "new", newInterval)
			interval = newInterval
			ticker.Reset(interval)
		}
		<-ticker.C
	}
}

// sendHeartbeat sends one heartbeat and returns the new heartbeat interval
// if the server config changed it (0 means no change).
func sendHeartbeat(client *http.Client, baseURL, agentID, version string, sys *sysinfo.SystemInfo, cmdCh chan<- Command, configCh chan<- ConfigUpdate) time.Duration {
	hostname, _ := os.Hostname()
	osFamily, osVersion := detectOS()
	resources := sysinfo.MeasureResources()

	payload := HeartbeatPayload{
		AgentVersion:  version,
		Hostname:      hostname,
		OSFamily:      osFamily,
		OSVersion:     osVersion,
		ResourceUsage: &resources,
		SystemInfo:    sys,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		slog.Error("failed to marshal heartbeat", "error", err)
		return 0
	}

	url := fmt.Sprintf("%s/v1/agents/heartbeat", baseURL)

	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		slog.Error("failed to create heartbeat request", "error", err)
		return 0
	}
	req.Header.Set("Content-Type", "application/json")

	if strings.HasPrefix(baseURL, "http://") {
		req.Header.Set("X-Agent-CN", fmt.Sprintf("ag_%s.agents.securitycentral.io", agentID))
	}

	resp, err := client.Do(req)
	if err != nil {
		slog.Warn("heartbeat failed", "error", err)
		return 0
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		slog.Warn("heartbeat returned non-200", "status", resp.StatusCode)
		return 0
	}

	var hbResp HeartbeatResponse
	if err := json.NewDecoder(resp.Body).Decode(&hbResp); err != nil {
		slog.Warn("failed to decode heartbeat response", "error", err)
		return 0
	}

	// Forward commands to scheduler
	for _, cmd := range hbResp.Data.Commands {
		slog.Info("received command", "type", cmd.Type)
		select {
		case cmdCh <- cmd:
		default:
			slog.Warn("command channel full, dropping command", "type", cmd.Type)
		}
	}

	// Forward config update if present
	var newHeartbeatInterval time.Duration
	if hbResp.Data.Config != nil {
		select {
		case configCh <- ConfigUpdate{Config: *hbResp.Data.Config}:
		default:
			// Non-blocking — scheduler will pick up next time
		}
		newHeartbeatInterval = hbResp.Data.Config.HeartbeatInterval()
	}

	return newHeartbeatInterval
}

func detectOS() (family, version string) {
	data, err := os.ReadFile("/etc/os-release")
	if err != nil {
		return "unknown", "unknown"
	}

	vars := parseOSRelease(string(data))
	id := vars["ID"]
	ver := vars["VERSION_ID"]

	switch id {
	case "ubuntu", "debian":
		return id, ver
	case "centos", "rhel", "rocky", "alma":
		return "centos", ver
	case "alpine":
		return "alpine", ver
	default:
		return id, ver
	}
}

func parseOSRelease(content string) map[string]string {
	vars := make(map[string]string)
	for _, line := range strings.Split(content, "\n") {
		parts := strings.SplitN(line, "=", 2)
		if len(parts) == 2 {
			vars[parts[0]] = strings.Trim(parts[1], "\"")
		}
	}
	return vars
}
