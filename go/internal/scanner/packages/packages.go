// Package packages implements OS package enumeration for infrastructure scanning.
package packages

import (
	"fmt"
	"log/slog"
	"os/exec"
	"strings"
	"time"

	"github.com/security-central/security-central/internal/config"
	"github.com/security-central/security-central/internal/platform"
	"github.com/security-central/security-central/internal/vulndb"
	"github.com/security-central/security-central/pkg/models"
)

// Package represents an installed OS package.
type Package struct {
	Name    string
	Version string
	Arch    string
}

// RunScan performs a full OS package scan and submits findings to the platform.
func RunScan(client *platform.Client, cfg *config.AgentConfig) error {
	osFamily, osVersion := detectOS()
	slog.Info("scanning packages", "os_family", osFamily, "os_version", osVersion)

	startTime := time.Now()

	pkgs, err := EnumeratePackages(osFamily)
	if err != nil {
		return fmt.Errorf("enumerate packages: %w", err)
	}
	slog.Info("enumerated packages", "count", len(pkgs))

	db, err := vulndb.Open()
	if err != nil {
		return fmt.Errorf("open vulndb: %w", err)
	}

	var findings []models.Finding
	for _, pkg := range pkgs {
		vulns, err := db.LookupOS(osFamily, osVersion, pkg.Name)
		if err != nil || len(vulns) == 0 {
			continue
		}

		for _, v := range vulns {
			findings = append(findings, models.Finding{
				Source:   models.SourceInfra,
				Severity: cvssToSeverity(v.CvssScore),
				Title:    fmt.Sprintf("%s in %s-%s", v.CveID, pkg.Name, pkg.Version),
				Description: fmt.Sprintf("Package %s version %s is affected by %s", pkg.Name, pkg.Version, v.CveID),
				CveID:    v.CveID,
				CvssScore: v.CvssScore,
				Remediation: fmt.Sprintf("Update %s to version %s or later", pkg.Name, v.FixedVersion),
				AutoFixable: v.FixedVersion != "",
				Detail: map[string]any{
					"package_name":      pkg.Name,
					"installed_version": pkg.Version,
					"fixed_version":     v.FixedVersion,
					"os_family":         osFamily,
					"os_version":        osVersion,
					"arch":              pkg.Arch,
				},
				FirstSeenAt: time.Now(),
			})
		}
	}

	completedTime := time.Now()
	slog.Info("vulnerability matching complete", "findings", len(findings))

	if client != nil && len(findings) > 0 {
		_, err := client.SubmitFindings(findings, "infra_packages", startTime, completedTime)
		if err != nil {
			return fmt.Errorf("submit findings: %w", err)
		}
	}

	return nil
}

// EnumeratePackages detects installed packages based on the OS family.
func EnumeratePackages(osFamily string) ([]Package, error) {
	switch osFamily {
	case "ubuntu", "debian":
		return enumerateDpkg()
	case "centos", "rhel", "rocky", "alma":
		return enumerateRpm()
	case "alpine":
		return enumerateApk()
	default:
		return nil, fmt.Errorf("unsupported OS family: %s", osFamily)
	}
}

// --- Ubuntu/Debian: dpkg ---

func enumerateDpkg() ([]Package, error) {
	out, err := exec.Command("dpkg-query", "-W", "-f", "${Package}\t${Version}\t${Architecture}\n").Output()
	if err != nil {
		return nil, fmt.Errorf("dpkg-query: %w", err)
	}
	return parseTSV(string(out)), nil
}

// --- CentOS/RHEL: rpm ---

func enumerateRpm() ([]Package, error) {
	out, err := exec.Command("rpm", "-qa", "--queryformat", "%{NAME}\t%{VERSION}-%{RELEASE}\t%{ARCH}\n").Output()
	if err != nil {
		return nil, fmt.Errorf("rpm: %w", err)
	}
	return parseTSV(string(out)), nil
}

// --- Alpine: parse /lib/apk/db/installed ---

func enumerateApk() ([]Package, error) {
	return ParseApkDB("/lib/apk/db/installed")
}

// ParseApkDB parses the Alpine APK database file.
func ParseApkDB(path string) ([]Package, error) {
	data, err := exec.Command("cat", path).Output()
	if err != nil {
		// Fallback to apk command
		out, err2 := exec.Command("apk", "list", "--installed").Output()
		if err2 != nil {
			return nil, fmt.Errorf("read APK DB: %w", err)
		}
		return parseApkList(string(out)), nil
	}

	return parseApkInstalled(string(data)), nil
}

func parseTSV(output string) []Package {
	var pkgs []Package
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		parts := strings.SplitN(line, "\t", 3)
		if len(parts) < 2 {
			continue
		}
		pkg := Package{Name: parts[0], Version: parts[1]}
		if len(parts) >= 3 {
			pkg.Arch = parts[2]
		}
		pkgs = append(pkgs, pkg)
	}
	return pkgs
}

func parseApkInstalled(content string) []Package {
	var pkgs []Package
	var current Package

	for _, line := range strings.Split(content, "\n") {
		if line == "" {
			if current.Name != "" {
				pkgs = append(pkgs, current)
				current = Package{}
			}
			continue
		}
		if len(line) < 2 || line[1] != ':' {
			continue
		}
		switch line[0] {
		case 'P':
			current.Name = line[2:]
		case 'V':
			current.Version = line[2:]
		case 'A':
			current.Arch = line[2:]
		}
	}
	if current.Name != "" {
		pkgs = append(pkgs, current)
	}

	return pkgs
}

func parseApkList(output string) []Package {
	var pkgs []Package
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		// Format: package-name-version arch {origin} (license)
		parts := strings.Fields(line)
		if len(parts) < 1 {
			continue
		}
		nameVer := parts[0]
		lastDash := strings.LastIndex(nameVer, "-")
		if lastDash <= 0 {
			continue
		}
		secondLastDash := strings.LastIndex(nameVer[:lastDash], "-")
		if secondLastDash <= 0 {
			continue
		}
		pkgs = append(pkgs, Package{
			Name:    nameVer[:secondLastDash],
			Version: nameVer[secondLastDash+1:],
		})
	}
	return pkgs
}

func detectOS() (string, string) {
	out, err := exec.Command("cat", "/etc/os-release").Output()
	if err != nil {
		return "unknown", "unknown"
	}
	vars := make(map[string]string)
	for _, line := range strings.Split(string(out), "\n") {
		parts := strings.SplitN(line, "=", 2)
		if len(parts) == 2 {
			vars[parts[0]] = strings.Trim(parts[1], "\"")
		}
	}
	id := vars["ID"]
	switch id {
	case "ubuntu", "debian":
		return id, vars["VERSION_ID"]
	case "centos", "rhel", "rocky", "alma":
		return "centos", vars["VERSION_ID"]
	case "alpine":
		return "alpine", vars["VERSION_ID"]
	default:
		return id, vars["VERSION_ID"]
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
