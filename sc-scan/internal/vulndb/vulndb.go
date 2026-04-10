// Package vulndb provides access to the local vulnerability database.
// In MVP, this uses a JSON file downloaded from the platform.
package vulndb

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// VulnEntry represents a single vulnerability record in the database.
type VulnEntry struct {
	CveID         string  `json:"cve_id"`
	AffectedRange string  `json:"affected"`
	FixedVersion  string  `json:"fixed"`
	CvssScore     float64 `json:"cvss"`
}

// DB is the vulnerability database handle.
type DB struct {
	Buckets map[string]map[string][]VulnEntry
}

// Open loads the vulnerability database from the default path.
func Open() (*DB, error) {
	paths := []string{
		os.Getenv("SC_VULNDB_PATH"),
		filepath.Join(os.Getenv("HOME"), ".securitycentral", "vulndb.json"),
		"vulndb.json",
	}

	for _, p := range paths {
		if p == "" {
			continue
		}
		db, err := loadFromFile(p)
		if err == nil {
			return db, nil
		}
		if !os.IsNotExist(err) {
			return nil, fmt.Errorf("load vulndb from %s: %w", p, err)
		}
	}

	return &DB{Buckets: make(map[string]map[string][]VulnEntry)}, nil
}

func loadFromFile(path string) (*DB, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var buckets map[string]map[string][]VulnEntry
	if err := json.Unmarshal(data, &buckets); err != nil {
		return nil, fmt.Errorf("parse vulndb: %w", err)
	}

	return &DB{Buckets: buckets}, nil
}

// Lookup queries the DB for vulnerabilities affecting the given package.
func (db *DB) Lookup(ecosystem, packageName string) ([]VulnEntry, error) {
	if pkgs, ok := db.Buckets[ecosystem]; ok {
		if entries, ok := pkgs[packageName]; ok {
			return entries, nil
		}
	}
	return nil, nil
}
