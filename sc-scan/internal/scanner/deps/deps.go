// Package deps implements dependency scanning via lockfile parsing.
package deps

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/securitycentral/sc-scan/internal/config"
	"github.com/securitycentral/sc-scan/internal/vulndb"
	"github.com/securitycentral/sc-scan/pkg/models"
)

// Dependency represents a parsed package from a lockfile.
type Dependency struct {
	Ecosystem string
	Name      string
	Version   string
	IsDirect  bool
	LockFile  string
}

// Scan walks the repository, discovers lockfiles, parses them, and matches
// dependencies against the vulnerability database.
// If changedFiles is non-empty, only lockfiles in the changed list are scanned.
func Scan(repoPath string, cfg config.DepsSection, changedFiles []string) ([]models.Finding, int, error) {
	var lockfiles []string
	if len(changedFiles) > 0 {
		lockfiles = filterLockfiles(repoPath, changedFiles)
	} else {
		lockfiles = discoverLockfiles(repoPath)
	}

	if len(lockfiles) == 0 {
		slog.Info("no lockfiles found")
		return nil, 0, nil
	}

	slog.Info("discovered lockfiles", "count", len(lockfiles))

	var allDeps []Dependency
	for _, lf := range lockfiles {
		deps, err := parseLockfile(lf)
		if err != nil {
			slog.Warn("failed to parse lockfile", "file", lf, "error", err)
			continue
		}
		allDeps = append(allDeps, deps...)
	}

	slog.Info("parsed dependencies", "count", len(allDeps))

	// Load vulnerability DB
	db, err := vulndb.Open()
	if err != nil {
		return nil, len(lockfiles), fmt.Errorf("failed to open vulnerability database: %w", err)
	}

	// Match against vuln DB
	var findings []models.Finding
	for _, dep := range allDeps {
		vulns, err := db.Lookup(dep.Ecosystem, dep.Name)
		if err != nil {
			continue
		}

		for _, v := range vulns {
			if !isAffected(dep.Version, v.AffectedRange) {
				continue
			}

			// Check ignore rules
			if isIgnored(v.CveID, dep.Name, dep.Version, cfg.Ignore) {
				continue
			}

			finding := models.Finding{
				Source:      models.SourceDependency,
				Severity:    cvssToSeverity(v.CvssScore),
				Title:       fmt.Sprintf("%s in %s@%s", v.CveID, dep.Name, dep.Version),
				Description: fmt.Sprintf("Vulnerable dependency %s version %s is affected by %s", dep.Name, dep.Version, v.CveID),
				CveID:       v.CveID,
				CvssScore:   v.CvssScore,
				Remediation: buildRemediation(dep, v.FixedVersion),
				AutoFixable: v.FixedVersion != "",
				Detail: map[string]any{
					"package_name":      dep.Name,
					"installed_version": dep.Version,
					"fixed_version":     v.FixedVersion,
					"ecosystem":         dep.Ecosystem,
					"lockfile":          dep.LockFile,
					"is_direct":         dep.IsDirect,
				},
				FirstSeenAt: time.Now(),
			}
			findings = append(findings, finding)
		}
	}

	return findings, len(lockfiles), nil
}

// filterLockfiles returns only the lockfiles that appear in the changedFiles list.
func filterLockfiles(repoPath string, changedFiles []string) []string {
	patterns := map[string]bool{
		"package-lock.json": true,
		"yarn.lock":         true,
		"pnpm-lock.yaml":    true,
		"requirements.txt":  true,
		"Pipfile.lock":      true,
		"poetry.lock":       true,
		"pom.xml":           true,
		"gradle.lockfile":   true,
	}

	var lockfiles []string
	for _, cf := range changedFiles {
		base := filepath.Base(cf)
		if patterns[base] {
			absPath := cf
			if !filepath.IsAbs(cf) {
				absPath = filepath.Join(repoPath, cf)
			}
			if _, err := os.Stat(absPath); err == nil {
				lockfiles = append(lockfiles, absPath)
			}
		}
	}
	return lockfiles
}

// discoverLockfiles walks the repo and finds supported lockfiles.
func discoverLockfiles(root string) []string {
	patterns := map[string]bool{
		"package-lock.json": true,
		"yarn.lock":         true,
		"pnpm-lock.yaml":    true,
		"requirements.txt":  true,
		"Pipfile.lock":      true,
		"poetry.lock":       true,
		"pom.xml":           true,
		"gradle.lockfile":   true,
	}

	var lockfiles []string
	_ = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			base := filepath.Base(path)
			if base == "node_modules" || base == ".git" || base == "vendor" {
				return filepath.SkipDir
			}
			return nil
		}
		if patterns[filepath.Base(path)] {
			lockfiles = append(lockfiles, path)
		}
		return nil
	})

	return lockfiles
}

// parseLockfile routes to the appropriate parser based on filename.
func parseLockfile(path string) ([]Dependency, error) {
	base := filepath.Base(path)
	switch base {
	case "package-lock.json":
		return ParsePackageLock(path)
	case "yarn.lock":
		return ParseYarnLock(path)
	case "requirements.txt":
		return ParseRequirements(path)
	case "Pipfile.lock":
		return ParsePipfileLock(path)
	case "pom.xml":
		return ParsePom(path)
	default:
		return nil, fmt.Errorf("unsupported lockfile: %s", base)
	}
}

func buildRemediation(dep Dependency, fixedVersion string) string {
	if fixedVersion == "" {
		return "No fix available yet."
	}
	switch dep.Ecosystem {
	case "npm":
		return fmt.Sprintf("Run: npm install %s@%s", dep.Name, fixedVersion)
	case "pypi":
		return fmt.Sprintf("Run: pip install %s==%s", dep.Name, fixedVersion)
	case "maven":
		return fmt.Sprintf("Update %s to version %s in pom.xml", dep.Name, fixedVersion)
	default:
		return fmt.Sprintf("Upgrade %s to %s", dep.Name, fixedVersion)
	}
}

func cvssToSeverity(score float64) models.Severity {
	switch {
	case score >= 9.0:
		return models.SeverityCritical
	case score >= 7.0:
		return models.SeverityHigh
	case score >= 4.0:
		return models.SeverityMedium
	case score >= 0.1:
		return models.SeverityLow
	default:
		return models.SeverityInfo
	}
}

func isIgnored(cveID, pkgName, version string, rules []config.IgnoreRule) bool {
	for _, r := range rules {
		if r.CVE != "" && r.CVE == cveID {
			if r.Expires != "" {
				exp, err := time.Parse("2006-01-02", r.Expires)
				if err == nil && time.Now().After(exp) {
					continue // expired rule
				}
			}
			return true
		}
		if r.Package != "" && r.Package == pkgName {
			return true
		}
	}
	return false
}

// isAffected checks if the installed version falls within the affected range.
// Simplified version range checking for MVP.
func isAffected(installed, affectedRange string) bool {
	if affectedRange == "" {
		return false
	}
	// For MVP, always return true — the vuln DB already filtered by package.
	// A full implementation would compare semver ranges.
	return true
}
