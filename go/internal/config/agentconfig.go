package config

import (
	"fmt"
	"os"
	"time"

	"gopkg.in/yaml.v3"
)

// AgentConfig holds configuration for the sc-agent binary.
type AgentConfig struct {
	AgentID     string        `yaml:"agent_id"`
	APIURL      string        `yaml:"api_url"`
	TLS         TLSConfig     `yaml:"tls"`
	Scan        AgentScanConfig `yaml:"scan"`
	Heartbeat   HeartbeatConfig `yaml:"heartbeat"`
	Environment string        `yaml:"environment"`
}

// TLSConfig holds mTLS certificate paths.
type TLSConfig struct {
	Cert string `yaml:"cert"`
	Key  string `yaml:"key"`
	CA   string `yaml:"ca"`
}

// AgentScanConfig controls scan behavior.
type AgentScanConfig struct {
	OnStartup  bool          `yaml:"on_startup"`
	Interval   time.Duration `yaml:"interval"`
	Packages   bool          `yaml:"packages"`
	Compliance bool          `yaml:"compliance"`
}

// HeartbeatConfig controls heartbeat behavior.
type HeartbeatConfig struct {
	Interval time.Duration `yaml:"interval"`
}

// LoadAgentConfig reads and validates the agent configuration file.
func LoadAgentConfig(path string) (*AgentConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config file: %w", err)
	}

	cfg := &AgentConfig{
		APIURL:      "https://api.securitycentral.io",
		Environment: "production",
		Scan: AgentScanConfig{
			OnStartup:  true,
			Interval:   6 * time.Hour,
			Packages:   true,
			Compliance: true,
		},
		Heartbeat: HeartbeatConfig{
			Interval: 60 * time.Second,
		},
	}

	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	if cfg.AgentID == "" {
		return nil, fmt.Errorf("agent_id is required")
	}
	if cfg.TLS.Cert == "" || cfg.TLS.Key == "" || cfg.TLS.CA == "" {
		return nil, fmt.Errorf("tls.cert, tls.key, and tls.ca are required")
	}

	return cfg, nil
}
