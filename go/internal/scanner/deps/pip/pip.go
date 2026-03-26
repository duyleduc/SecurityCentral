// Package pip parses Python dependency lockfiles.
package pip

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/security-central/security-central/internal/scanner/deps"
)

// ParseRequirements parses a requirements.txt file with pinned versions.
func ParseRequirements(path string) ([]deps.Dependency, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read requirements.txt: %w", err)
	}

	var result []deps.Dependency
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "-") {
			continue
		}

		// Handle pkg==version format
		if parts := strings.SplitN(line, "==", 2); len(parts) == 2 {
			name := strings.TrimSpace(parts[0])
			version := strings.TrimSpace(parts[1])
			// Strip extras: pkg[extra]==version
			if idx := strings.Index(name, "["); idx > 0 {
				name = name[:idx]
			}
			result = append(result, deps.Dependency{
				Ecosystem: "pypi",
				Name:      strings.ToLower(name),
				Version:   version,
				IsDirect:  true,
				LockFile:  path,
			})
		}
	}

	return result, nil
}

// pipfileLock represents the structure of Pipfile.lock.
type pipfileLock struct {
	Default map[string]pipfileEntry `json:"default"`
	Develop map[string]pipfileEntry `json:"develop"`
}

type pipfileEntry struct {
	Version string `json:"version"`
}

// ParsePipfileLock parses a Pipfile.lock file.
func ParsePipfileLock(path string) ([]deps.Dependency, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read Pipfile.lock: %w", err)
	}

	var lock pipfileLock
	if err := json.Unmarshal(data, &lock); err != nil {
		return nil, fmt.Errorf("parse Pipfile.lock: %w", err)
	}

	var result []deps.Dependency
	for name, entry := range lock.Default {
		version := strings.TrimPrefix(entry.Version, "==")
		result = append(result, deps.Dependency{
			Ecosystem: "pypi",
			Name:      strings.ToLower(name),
			Version:   version,
			IsDirect:  true,
			LockFile:  path,
		})
	}

	return result, nil
}
