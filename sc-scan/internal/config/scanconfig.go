// Package config handles configuration loading from .securitycentral.yml.
package config

import (
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

// ScanConfig holds the merged configuration for sc-scan.
type ScanConfig struct {
	// From .securitycentral.yml
	Version int            `yaml:"version"`
	Scan    ScanSection    `yaml:"scan"`
	Deps    DepsSection    `yaml:"dependencies"`
	Secrets SecretsSection `yaml:"secrets"`
}

// ScanSection controls which scanners are enabled.
type ScanSection struct {
	Dependencies bool `yaml:"dependencies"`
	Secrets      bool `yaml:"secrets"`
	Configs      bool `yaml:"configs"`
	Patterns     bool `yaml:"patterns"`
}

// DepsSection holds dependency scanning configuration.
type DepsSection struct {
	Ignore []IgnoreRule `yaml:"ignore"`
}

// IgnoreRule describes a CVE or package to suppress.
type IgnoreRule struct {
	CVE     string `yaml:"cve"`
	Package string `yaml:"package"`
	Below   string `yaml:"below"`
	Reason  string `yaml:"reason"`
	Expires string `yaml:"expires"` // ISO date
}

// SecretsSection holds secrets scanning configuration.
type SecretsSection struct {
	Allow []AllowRule `yaml:"allow"`
}

// AllowRule describes a secrets allowlist entry.
type AllowRule struct {
	Path    string `yaml:"path"`
	Pattern string `yaml:"pattern"`
	Hash    string `yaml:"hash"`
}

// LoadConfigFile reads .securitycentral.yml from the given directory.
// Returns a default config if the file does not exist.
func LoadConfigFile(dir string) (ScanConfig, error) {
	cfg := ScanConfig{
		Scan: ScanSection{
			Dependencies: true,
			Secrets:      true,
			Configs:      true,
			Patterns:     true,
		},
	}

	path := filepath.Join(dir, ".securitycentral.yml")
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return cfg, nil
		}
		return cfg, err
	}

	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return cfg, err
	}

	return cfg, nil
}
