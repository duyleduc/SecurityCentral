package config

import (
	"encoding/json"
	"fmt"
	"os"
)

type Config struct {
	APIBaseURL     string  `json:"apiBaseUrl"`
	AgentID        string  `json:"agentId"`
	APIKey         string  `json:"apiKey"`
	CPUThresh      float64 `json:"cpuThreshold"`
	RAMThresh      float64 `json:"ramThreshold"`
	DiskThresh     float64 `json:"diskThreshold"`
	IOWaitThresh   float64 `json:"ioWaitThreshold"`
	SpikeThresh    float64 `json:"spikeThreshold"`
}

func DefaultConfig() *Config {
	return &Config{
		APIBaseURL:   "http://localhost:3000",
		CPUThresh:    85.0,
		RAMThresh:    85.0,
		DiskThresh:   90.0,
		IOWaitThresh: 20.0,
		SpikeThresh:  40.0,
	}
}

func LoadFromFile(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}

	cfg := DefaultConfig()
	if err := json.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	return cfg, nil
}

func (c *Config) SaveToFile(path string) error {
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal config: %w", err)
	}
	return os.WriteFile(path, data, 0600)
}
