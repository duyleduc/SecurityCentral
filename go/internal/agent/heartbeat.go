// Package agent implements the infrastructure agent's core lifecycle.
package agent

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"runtime"
	"strings"
	"time"
)

// HeartbeatPayload is sent to the platform every heartbeat interval.
type HeartbeatPayload struct {
	AgentVersion  string         `json:"agentVersion"`
	Hostname      string         `json:"hostname,omitempty"`
	OSFamily      string         `json:"osFamily,omitempty"`
	OSVersion     string         `json:"osVersion,omitempty"`
	ResourceUsage *ResourceUsage `json:"resourceUsage,omitempty"`
}

// ResourceUsage reports host resource utilization.
type ResourceUsage struct {
	CPUPercent    float64 `json:"cpuPercent,omitempty"`
	MemoryPercent float64 `json:"memoryPercent,omitempty"`
	DiskPercent   float64 `json:"diskPercent,omitempty"`
}

// HeartbeatResponse from the platform.
type HeartbeatResponse struct {
	Data struct {
		Commands []Command `json:"commands"`
	} `json:"data"`
}

// Command is an instruction from the platform.
type Command struct {
	Type    string         `json:"type"` // scan_now | update_agent | update_vulndb
	Payload map[string]any `json:"payload,omitempty"`
}

// HeartbeatLoop sends heartbeats at the configured interval and processes commands.
func HeartbeatLoop(client *http.Client, baseURL, agentID, version string, interval time.Duration, cmdCh chan<- Command) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		sendHeartbeat(client, baseURL, agentID, version, cmdCh)
		<-ticker.C
	}
}

func sendHeartbeat(client *http.Client, baseURL, agentID, version string, cmdCh chan<- Command) {
	hostname, _ := os.Hostname()
	osFamily, osVersion := detectOS()

	payload := HeartbeatPayload{
		AgentVersion: version,
		Hostname:     hostname,
		OSFamily:     osFamily,
		OSVersion:    osVersion,
		ResourceUsage: &ResourceUsage{
			MemoryPercent: memoryUsage(),
		},
	}

	body, err := json.Marshal(payload)
	if err != nil {
		slog.Error("failed to marshal heartbeat", "error", err)
		return
	}

	url := fmt.Sprintf("%s/v1/agents/heartbeat", baseURL)
	resp, err := client.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		slog.Warn("heartbeat failed", "error", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		slog.Warn("heartbeat returned non-200", "status", resp.StatusCode)
		return
	}

	var hbResp HeartbeatResponse
	if err := json.NewDecoder(resp.Body).Decode(&hbResp); err != nil {
		slog.Warn("failed to decode heartbeat response", "error", err)
		return
	}

	for _, cmd := range hbResp.Data.Commands {
		slog.Info("received command", "type", cmd.Type)
		select {
		case cmdCh <- cmd:
		default:
			slog.Warn("command channel full, dropping command", "type", cmd.Type)
		}
	}
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

func memoryUsage() float64 {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	// This is Go process memory, not system memory. Real implementation
	// would read /proc/meminfo.
	return float64(m.Alloc) / float64(m.Sys) * 100
}
