// Package config handles configuration loading from environment, flags, and files.
package config

import "os"

// Config holds the shared configuration for all SecurityCentral Go components.
type Config struct {
	PlatformURL string
	AgentID     string
	OrgID       string
	APIKey      string
	TLSCertPath string
	TLSKeyPath  string
}

// Load reads configuration from environment variables.
func Load() Config {
	return Config{
		PlatformURL: getEnv("SC_PLATFORM_URL", "https://localhost:3000"),
		AgentID:     getEnv("SC_AGENT_ID", ""),
		OrgID:       getEnv("SC_ORG_ID", ""),
		APIKey:      getEnv("SC_API_KEY", ""),
		TLSCertPath: getEnv("SC_TLS_CERT", ""),
		TLSKeyPath:  getEnv("SC_TLS_KEY", ""),
	}
}

func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}
