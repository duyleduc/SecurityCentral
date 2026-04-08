// Package secrets implements secret pattern detection in source code.
package secrets

import (
	"bufio"
	"crypto/sha256"
	"fmt"
	"log/slog"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/security-central/security-central/internal/config"
	"github.com/security-central/security-central/pkg/models"
)

// Pattern defines a regex-based secret detection rule.
type Pattern struct {
	Name     string
	Regex    *regexp.Regexp
	Severity models.Severity
	Category string
	Entropy  bool // if true, apply entropy filter
}

// Scan walks the repository and scans files for secrets.
func Scan(repoPath string, cfg config.SecretsSection, incremental bool) ([]models.Finding, error) {
	patterns := BuildPatterns()
	allowRules := cfg.Allow

	var findings []models.Finding

	err := filepath.Walk(repoPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			if shouldSkipDir(info.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		if shouldSkipFile(path, info) {
			return nil
		}

		relPath, _ := filepath.Rel(repoPath, path)
		fileFindings, err := scanFile(path, relPath, patterns, allowRules)
		if err != nil {
			slog.Debug("failed to scan file", "file", relPath, "error", err)
			return nil
		}
		findings = append(findings, fileFindings...)
		return nil
	})

	return findings, err
}

func scanFile(absPath, relPath string, patterns []Pattern, allowRules []config.AllowRule) ([]models.Finding, error) {
	file, err := os.Open(absPath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var findings []models.Finding
	scanner := bufio.NewScanner(file)
	lineNum := 0

	for scanner.Scan() {
		lineNum++
		line := scanner.Text()

		for _, p := range patterns {
			matches := p.Regex.FindAllString(line, -1)
			for _, match := range matches {
				if p.Entropy && ShannonEntropy(match) < 4.5 {
					continue
				}
				if IsAllowed(relPath, match, p.Name, allowRules) {
					continue
				}

				findings = append(findings, models.Finding{
					Source:      models.SourceSecret,
					Severity:    p.Severity,
					Title:       fmt.Sprintf("%s detected in %s", p.Name, relPath),
					Description: fmt.Sprintf("Potential %s found at %s:%d", p.Category, relPath, lineNum),
					Detail: map[string]any{
						"file":         relPath,
						"line":         lineNum,
						"pattern_name": p.Name,
						"category":     p.Category,
						"match_prefix": truncateMatch(match, 8),
					},
					FirstSeenAt: time.Now(),
				})
			}
		}
	}

	return findings, scanner.Err()
}

// BuildPatterns returns all 50 core secret detection patterns.
func BuildPatterns() []Pattern {
	var patterns []Pattern
	patterns = append(patterns, cloudPatterns()...)
	patterns = append(patterns, apiTokenPatterns()...)
	patterns = append(patterns, credentialPatterns()...)
	patterns = append(patterns, genericPatterns()...)
	return patterns
}

func cloudPatterns() []Pattern {
	return []Pattern{
		{Name: "AWS Access Key", Regex: regexp.MustCompile(`AKIA[0-9A-Z]{16}`), Severity: models.SeverityCritical, Category: "cloud"},
		{Name: "AWS Secret Key", Regex: regexp.MustCompile(`(?i)aws_secret_access_key\s*[=:]\s*[A-Za-z0-9/+=]{40}`), Severity: models.SeverityCritical, Category: "cloud"},
		{Name: "AWS Session Token", Regex: regexp.MustCompile(`(?i)aws_session_token\s*[=:]\s*[A-Za-z0-9/+=]{100,}`), Severity: models.SeverityHigh, Category: "cloud"},
		{Name: "GCP API Key", Regex: regexp.MustCompile(`AIza[0-9A-Za-z_-]{35}`), Severity: models.SeverityHigh, Category: "cloud"},
		{Name: "GCP Service Account", Regex: regexp.MustCompile(`"type"\s*:\s*"service_account"`), Severity: models.SeverityCritical, Category: "cloud"},
		{Name: "Azure Storage Key", Regex: regexp.MustCompile(`(?i)AccountKey=[A-Za-z0-9+/=]{86,}`), Severity: models.SeverityCritical, Category: "cloud"},
		{Name: "Azure Connection String", Regex: regexp.MustCompile(`DefaultEndpointsProtocol=https;AccountName=`), Severity: models.SeverityHigh, Category: "cloud"},
		{Name: "DigitalOcean Token", Regex: regexp.MustCompile(`dop_v1_[a-f0-9]{64}`), Severity: models.SeverityHigh, Category: "cloud"},
		{Name: "Alibaba Access Key", Regex: regexp.MustCompile(`LTAI[A-Za-z0-9]{20}`), Severity: models.SeverityCritical, Category: "cloud"},
		{Name: "IBM Cloud API Key", Regex: regexp.MustCompile(`(?i)ibm_api_key\s*[=:]\s*[A-Za-z0-9_-]{44}`), Severity: models.SeverityHigh, Category: "cloud"},
	}
}

func apiTokenPatterns() []Pattern {
	return []Pattern{
		{Name: "GitHub PAT", Regex: regexp.MustCompile(`ghp_[A-Za-z0-9]{36}`), Severity: models.SeverityHigh, Category: "api_token"},
		{Name: "GitHub OAuth", Regex: regexp.MustCompile(`gho_[A-Za-z0-9]{36}`), Severity: models.SeverityHigh, Category: "api_token"},
		{Name: "GitHub App Token", Regex: regexp.MustCompile(`(?:ghu|ghs)_[A-Za-z0-9]{36}`), Severity: models.SeverityHigh, Category: "api_token"},
		{Name: "GitLab Token", Regex: regexp.MustCompile(`glpat-[A-Za-z0-9_-]{20,}`), Severity: models.SeverityHigh, Category: "api_token"},
		{Name: "Slack Token", Regex: regexp.MustCompile(`xox[bporas]-[0-9]{10,}-[A-Za-z0-9-]+`), Severity: models.SeverityHigh, Category: "api_token"},
		{Name: "Slack Webhook", Regex: regexp.MustCompile(`https://hooks\.slack\.com/services/T[A-Z0-9]+/B[A-Z0-9]+/[A-Za-z0-9]+`), Severity: models.SeverityMedium, Category: "api_token"},
		{Name: "Stripe Secret Key", Regex: regexp.MustCompile(`sk_live_[0-9a-zA-Z]{24,}`), Severity: models.SeverityCritical, Category: "api_token"},
		{Name: "Stripe Publishable Key", Regex: regexp.MustCompile(`pk_live_[0-9a-zA-Z]{24,}`), Severity: models.SeverityLow, Category: "api_token"},
		{Name: "Twilio API Key", Regex: regexp.MustCompile(`SK[0-9a-fA-F]{32}`), Severity: models.SeverityHigh, Category: "api_token"},
		{Name: "SendGrid API Key", Regex: regexp.MustCompile(`SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}`), Severity: models.SeverityHigh, Category: "api_token"},
		{Name: "Mailgun API Key", Regex: regexp.MustCompile(`key-[0-9a-zA-Z]{32}`), Severity: models.SeverityHigh, Category: "api_token"},
		{Name: "Heroku API Key", Regex: regexp.MustCompile(`(?i)heroku.*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`), Severity: models.SeverityHigh, Category: "api_token"},
		{Name: "npm Token", Regex: regexp.MustCompile(`npm_[A-Za-z0-9]{36}`), Severity: models.SeverityHigh, Category: "api_token"},
		{Name: "PyPI Token", Regex: regexp.MustCompile(`pypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{50,}`), Severity: models.SeverityHigh, Category: "api_token"},
		{Name: "Telegram Bot Token", Regex: regexp.MustCompile(`[0-9]{8,}:AA[A-Za-z0-9_-]{33}`), Severity: models.SeverityMedium, Category: "api_token"},
	}
}

func credentialPatterns() []Pattern {
	return []Pattern{
		{Name: "RSA Private Key", Regex: regexp.MustCompile(`-----BEGIN RSA PRIVATE KEY-----`), Severity: models.SeverityCritical, Category: "private_key"},
		{Name: "EC Private Key", Regex: regexp.MustCompile(`-----BEGIN EC PRIVATE KEY-----`), Severity: models.SeverityCritical, Category: "private_key"},
		{Name: "PKCS8 Private Key", Regex: regexp.MustCompile(`-----BEGIN PRIVATE KEY-----`), Severity: models.SeverityCritical, Category: "private_key"},
		{Name: "OpenSSH Private Key", Regex: regexp.MustCompile(`-----BEGIN OPENSSH PRIVATE KEY-----`), Severity: models.SeverityCritical, Category: "private_key"},
		{Name: "PGP Private Key", Regex: regexp.MustCompile(`-----BEGIN PGP PRIVATE KEY BLOCK-----`), Severity: models.SeverityHigh, Category: "private_key"},
		{Name: "PostgreSQL URI", Regex: regexp.MustCompile(`postgres(?:ql)?://[^:]+:[^@]+@[^\s]+`), Severity: models.SeverityHigh, Category: "database"},
		{Name: "MySQL URI", Regex: regexp.MustCompile(`mysql://[^:]+:[^@]+@[^\s]+`), Severity: models.SeverityHigh, Category: "database"},
		{Name: "MongoDB URI", Regex: regexp.MustCompile(`mongodb(?:\+srv)?://[^:]+:[^@]+@[^\s]+`), Severity: models.SeverityHigh, Category: "database"},
		{Name: "Redis URI", Regex: regexp.MustCompile(`redis://:[^@]+@[^\s]+`), Severity: models.SeverityMedium, Category: "database"},
		{Name: "JWT Token", Regex: regexp.MustCompile(`eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+`), Severity: models.SeverityMedium, Category: "credential"},
	}
}

func genericPatterns() []Pattern {
	keywords := []string{
		"password", "passwd", "pwd",
		"secret", "secret_key",
		"token", "access_token", "auth_token",
		"api_key", "apikey", "api-key",
		"private_key", "private-key",
		"credential", "credentials",
		"encryption_key", "signing_key",
	}

	var patterns []Pattern
	for _, kw := range keywords {
		patterns = append(patterns, Pattern{
			Name:     fmt.Sprintf("Generic Secret (%s)", kw),
			Regex:    regexp.MustCompile(fmt.Sprintf(`(?i)%s\s*[=:]\s*["']?([A-Za-z0-9+/=_-]{16,})["']?`, regexp.QuoteMeta(kw))),
			Severity: models.SeverityMedium,
			Category: "generic",
			Entropy:  true,
		})
	}

	return patterns
}

// ShannonEntropy computes Shannon entropy of a string.
func ShannonEntropy(s string) float64 {
	if len(s) == 0 {
		return 0
	}
	freq := make(map[rune]float64)
	for _, c := range s {
		freq[c]++
	}
	n := float64(len(s))
	var entropy float64
	for _, count := range freq {
		p := count / n
		if p > 0 {
			entropy -= p * math.Log2(p)
		}
	}
	return entropy
}

// File exclusion helpers

func shouldSkipDir(name string) bool {
	skip := map[string]bool{
		".git": true, "node_modules": true, "vendor": true,
		"__pycache__": true, ".tox": true, ".venv": true,
		"testdata": true, "fixtures": true, "dist": true, "build": true,
	}
	return skip[name]
}

func shouldSkipFile(path string, info os.FileInfo) bool {
	if info.Size() > 1024*1024 {
		return true
	}
	base := filepath.Base(path)
	lockfiles := map[string]bool{
		"package-lock.json": true, "yarn.lock": true, "pnpm-lock.yaml": true,
		"Pipfile.lock": true, "poetry.lock": true, "Gemfile.lock": true,
		"go.sum": true, "Cargo.lock": true, "composer.lock": true,
	}
	if lockfiles[base] {
		return true
	}
	if strings.HasSuffix(base, "_test.go") || strings.HasSuffix(base, ".test.ts") ||
		strings.HasSuffix(base, ".test.js") || strings.HasSuffix(base, "_test.py") {
		return true
	}
	binaryExts := map[string]bool{
		".png": true, ".jpg": true, ".gif": true, ".ico": true, ".svg": true,
		".woff": true, ".woff2": true, ".ttf": true, ".eot": true,
		".zip": true, ".tar": true, ".gz": true, ".jar": true,
		".exe": true, ".dll": true, ".so": true, ".dylib": true,
		".pdf": true, ".mp4": true, ".mp3": true,
	}
	return binaryExts[strings.ToLower(filepath.Ext(path))]
}

// IsAllowed checks if a match should be suppressed per allowlist rules.
func IsAllowed(filePath, matchStr, patternName string, rules []config.AllowRule) bool {
	for _, r := range rules {
		if r.Path != "" {
			if matched, _ := filepath.Match(r.Path, filePath); matched {
				return true
			}
		}
		if r.Pattern != "" {
			if re, err := regexp.Compile(r.Pattern); err == nil && re.MatchString(matchStr) {
				return true
			}
		}
		if r.Hash != "" {
			hash := fmt.Sprintf("sha256:%x", sha256.Sum256([]byte(matchStr)))
			if r.Hash == hash {
				return true
			}
		}
	}
	return false
}

func truncateMatch(s string, prefixLen int) string {
	if len(s) <= prefixLen {
		return s
	}
	return s[:prefixLen] + "..."
}
