// Package config handles configuration loading from environment, flags, and files.
package config

import (
	"os"

	"gopkg.in/yaml.v3"
)

// ScanConfig holds the merged configuration for sc-scan.
type ScanConfig struct {
	Path         string `yaml:"-"`
	APIKey       string `yaml:"-"`
	APIURL       string `yaml:"-"`
	ScanDeps     bool   `yaml:"-"`
	ScanSecrets  bool   `yaml:"-"`
	Output       string `yaml:"-"` // table | json | sarif
	OutputFile   string `yaml:"-"`
	FailOn       string `yaml:"-"` // severity threshold
	Incremental  bool   `yaml:"-"`
	NoUpload     bool   `yaml:"-"`
	Verbose      bool   `yaml:"-"`

	// From .securitycentral.yml
	Version int              `yaml:"version"`
	Scan    ScanSection      `yaml:"scan"`
	Deps    DepsSection      `yaml:"dependencies"`
	Secrets SecretsSection   `yaml:"secrets"`
}

// ScanSection controls which scanners are enabled.
type ScanSection struct {
	Dependencies bool `yaml:"dependencies"`
	Secrets      bool `yaml:"secrets"`
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
// Returns a zero-value config if the file does not exist.
func LoadConfigFile(dir string) (ScanConfig, error) {
	var cfg ScanConfig
	cfg.Scan.Dependencies = true
	cfg.Scan.Secrets = true

	path := dir + "/.securitycentral.yml"
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

// Merge applies CLI flags on top of the config file.
// CLI flags take precedence over the config file.
func (c *ScanConfig) Merge(cli ScanConfig) {
	c.Path = cli.Path
	c.APIKey = cli.APIKey
	c.APIURL = cli.APIURL
	c.Output = cli.Output
	c.OutputFile = cli.OutputFile
	c.FailOn = cli.FailOn
	c.Incremental = cli.Incremental
	c.NoUpload = cli.NoUpload
	c.Verbose = cli.Verbose

	// CLI overrides config file scan settings
	c.ScanDeps = cli.ScanDeps
	c.ScanSecrets = cli.ScanSecrets
}
