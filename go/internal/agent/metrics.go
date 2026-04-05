package agent

import (
	"encoding/json"
	"log/slog"
	"os"
	"sync"
	"time"
)

const metricsPath = "/var/lib/securitycentral/metrics.json"
const consecutiveFailThreshold = 10

// Metrics tracks agent runtime statistics and persists them to disk.
type Metrics struct {
	mu sync.Mutex

	HeartbeatsTotal    int64  `json:"heartbeatsTotal"`
	HeartbeatsFailed   int64  `json:"heartbeatsFailed"`
	ConsecutiveFails   int64  `json:"consecutiveFails"`
	LastHeartbeat      string `json:"lastHeartbeat,omitempty"`
	LastHeartbeatError string `json:"lastHeartbeatError,omitempty"`
	LastScan           string `json:"lastScan,omitempty"`
	LastScanError      string `json:"lastScanError,omitempty"`
	ScansTotal         int64  `json:"scansTotal"`
	ScansFailed        int64  `json:"scansFailed"`
	Version            string `json:"version"`
	StartedAt          string `json:"startedAt"`
}

// NewMetrics creates a new metrics tracker.
func NewMetrics(version string) *Metrics {
	return &Metrics{
		Version:   version,
		StartedAt: time.Now().UTC().Format(time.RFC3339),
	}
}

// RecordHeartbeatSuccess records a successful heartbeat.
func (m *Metrics) RecordHeartbeatSuccess() {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.HeartbeatsTotal++
	m.ConsecutiveFails = 0
	m.LastHeartbeat = time.Now().UTC().Format(time.RFC3339)
	m.LastHeartbeatError = ""

	m.flush()
}

// RecordHeartbeatFailure records a failed heartbeat.
func (m *Metrics) RecordHeartbeatFailure(err string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.HeartbeatsTotal++
	m.HeartbeatsFailed++
	m.ConsecutiveFails++
	m.LastHeartbeatError = err

	if m.ConsecutiveFails%consecutiveFailThreshold == 0 {
		slog.Error("heartbeat failing repeatedly",
			"consecutive_failures", m.ConsecutiveFails,
			"last_error", err,
		)
	}

	m.flush()
}

// RecordScanSuccess records a successful scan.
func (m *Metrics) RecordScanSuccess() {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.ScansTotal++
	m.LastScan = time.Now().UTC().Format(time.RFC3339)
	m.LastScanError = ""

	m.flush()
}

// RecordScanFailure records a failed scan.
func (m *Metrics) RecordScanFailure(err string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.ScansTotal++
	m.ScansFailed++
	m.LastScanError = err

	m.flush()
}

// flush writes metrics to disk. Must be called with mu held.
func (m *Metrics) flush() {
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return
	}
	_ = os.MkdirAll("/var/lib/securitycentral", 0755)
	_ = os.WriteFile(metricsPath, data, 0644)
}

// LoadMetricsFromDisk reads the metrics file (used by sc-agent status).
func LoadMetricsFromDisk() (*Metrics, error) {
	data, err := os.ReadFile(metricsPath)
	if err != nil {
		return nil, err
	}
	var m Metrics
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, err
	}
	return &m, nil
}
