package config

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

// AgentConfig holds the identity-only configuration for the sc-agent binary.
// Behavioral settings (scan interval, compliance toggles, etc.) are managed
// server-side and delivered via the heartbeat response.
type AgentConfig struct {
	AgentID string    `yaml:"agent_id"`
	APIURL  string    `yaml:"api_url"`
	TLS     TLSConfig `yaml:"tls"`
}

// TLSConfig holds mTLS certificate paths.
type TLSConfig struct {
	Cert string `yaml:"cert"`
	Key  string `yaml:"key"`
	CA   string `yaml:"ca"`
}

// LoadAgentConfig reads and validates the agent configuration file.
// Unknown YAML fields (e.g., scan/heartbeat from older installs) are
// silently ignored for backward compatibility.
func LoadAgentConfig(path string) (*AgentConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config file: %w", err)
	}

	cfg := &AgentConfig{
		APIURL: "https://api.securitycentral.io",
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
