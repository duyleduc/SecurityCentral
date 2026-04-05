package agent

import "time"

// ServerConfig holds behavioral settings delivered by the platform via the
// heartbeat response. These are managed from the dashboard — the agent
// never writes them to disk.
type ServerConfig struct {
	Scan      ScanConfig      `json:"scan"`
	Heartbeat HeartbeatConfig `json:"heartbeat"`
	Environment string        `json:"environment"`
}

// ScanConfig controls what and when to scan.
type ScanConfig struct {
	Packages   bool   `json:"packages"`
	Compliance bool   `json:"compliance"`
	Interval   string `json:"interval"`   // e.g. "6h", "1h", "24h"
	OnStartup  bool   `json:"onStartup"`
}

// HeartbeatConfig controls heartbeat interval.
type HeartbeatConfig struct {
	Interval string `json:"interval"` // e.g. "60s"
}

// DefaultServerConfig returns safe defaults used before the first heartbeat.
func DefaultServerConfig() ServerConfig {
	return ServerConfig{
		Scan: ScanConfig{
			Packages:   true,
			Compliance: true,
			Interval:   "6h",
			OnStartup:  true,
		},
		Heartbeat: HeartbeatConfig{
			Interval: "60s",
		},
		Environment: "production",
	}
}

// ScanInterval parses the scan interval string to a time.Duration.
func (c *ServerConfig) ScanInterval() time.Duration {
	d, err := time.ParseDuration(c.Scan.Interval)
	if err != nil || d <= 0 {
		return 6 * time.Hour
	}
	return d
}

// HeartbeatInterval parses the heartbeat interval string to a time.Duration.
func (c *ServerConfig) HeartbeatInterval() time.Duration {
	d, err := time.ParseDuration(c.Heartbeat.Interval)
	if err != nil || d <= 0 {
		return 60 * time.Second
	}
	return d
}
