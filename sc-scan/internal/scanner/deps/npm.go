package deps

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// packageLockJSON represents the structure of package-lock.json (v2/v3).
type packageLockJSON struct {
	Packages map[string]packageEntry `json:"packages"`
}

type packageEntry struct {
	Version string `json:"version"`
	Dev     bool   `json:"dev"`
}

// ParsePackageLock parses a package-lock.json file.
func ParsePackageLock(path string) ([]Dependency, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read package-lock.json: %w", err)
	}

	var lock packageLockJSON
	if err := json.Unmarshal(data, &lock); err != nil {
		return nil, fmt.Errorf("parse package-lock.json: %w", err)
	}

	var result []Dependency
	for key, entry := range lock.Packages {
		if key == "" || entry.Version == "" {
			continue // root package
		}
		name := strings.TrimPrefix(key, "node_modules/")
		// Handle scoped packages
		if strings.Contains(name, "node_modules/") {
			name = name[strings.LastIndex(name, "node_modules/")+len("node_modules/"):]
		}

		result = append(result, Dependency{
			Ecosystem: "npm",
			Name:      name,
			Version:   entry.Version,
			IsDirect:  !strings.Contains(key, "node_modules/node_modules/"),
			LockFile:  path,
		})
	}

	return result, nil
}

// ParseYarnLock parses a yarn.lock (v1) file.
func ParseYarnLock(path string) ([]Dependency, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read yarn.lock: %w", err)
	}

	var result []Dependency
	lines := strings.Split(string(data), "\n")

	var currentPkg string
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}

		// Package header: "package@version:"
		if !strings.HasPrefix(line, " ") && strings.Contains(trimmed, "@") && strings.HasSuffix(trimmed, ":") {
			entry := strings.TrimSuffix(trimmed, ":")
			parts := strings.SplitN(entry, ",", 2)
			raw := strings.TrimSpace(parts[0])
			raw = strings.Trim(raw, "\"")
			atIdx := strings.LastIndex(raw, "@")
			if atIdx > 0 {
				currentPkg = raw[:atIdx]
			}
			continue
		}

		// Version line
		if strings.HasPrefix(trimmed, "version ") && currentPkg != "" {
			ver := strings.TrimPrefix(trimmed, "version ")
			ver = strings.Trim(ver, "\"")
			result = append(result, Dependency{
				Ecosystem: "npm",
				Name:      currentPkg,
				Version:   ver,
				IsDirect:  true, // yarn.lock doesn't distinguish
				LockFile:  path,
			})
			currentPkg = ""
		}
	}

	return result, nil
}
