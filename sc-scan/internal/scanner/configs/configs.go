// Package configs detects unsafe configuration patterns in source code.
package configs

import (
	"bufio"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/securitycentral/sc-scan/pkg/models"
)

// Rule defines a configuration security check.
type Rule struct {
	Name        string
	Regex       *regexp.Regexp
	Severity    models.Severity
	Category    string
	Description string
	Remediation string
	// FileFilter limits which files this rule applies to (empty = all).
	FileFilter func(path string) bool
}

// Scan walks the repository and scans files for unsafe configuration patterns.
// If changedFiles is non-empty, only those files are scanned.
func Scan(repoPath string, changedFiles []string) ([]models.Finding, int, error) {
	rules := buildRules()
	var findings []models.Finding
	filesScanned := 0

	if len(changedFiles) > 0 {
		for _, cf := range changedFiles {
			absPath := cf
			if !filepath.IsAbs(cf) {
				absPath = filepath.Join(repoPath, cf)
			}
			info, err := os.Stat(absPath)
			if err != nil || info.IsDir() {
				continue
			}
			if shouldSkipFile(absPath, info) {
				continue
			}
			relPath, _ := filepath.Rel(repoPath, absPath)
			fileFindings, err := scanFile(absPath, relPath, rules)
			if err != nil {
				slog.Debug("failed to scan file for configs", "file", relPath, "error", err)
				continue
			}
			filesScanned++
			findings = append(findings, fileFindings...)
		}
		return findings, filesScanned, nil
	}

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
		fileFindings, scanErr := scanFile(path, relPath, rules)
		if scanErr != nil {
			slog.Debug("failed to scan file for configs", "file", relPath, "error", scanErr)
			return nil
		}
		filesScanned++
		findings = append(findings, fileFindings...)
		return nil
	})

	return findings, filesScanned, err
}

func scanFile(absPath, relPath string, rules []Rule) ([]models.Finding, error) {
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

		for _, r := range rules {
			if r.FileFilter != nil && !r.FileFilter(relPath) {
				continue
			}
			if r.Regex.MatchString(line) {
				findings = append(findings, models.Finding{
					Source:      models.SourceConfig,
					Severity:    r.Severity,
					Title:       fmt.Sprintf("%s in %s", r.Name, relPath),
					Description: fmt.Sprintf("%s at %s:%d", r.Description, relPath, lineNum),
					Remediation: r.Remediation,
					Detail: map[string]any{
						"file":     relPath,
						"line":     lineNum,
						"rule":     r.Name,
						"category": r.Category,
					},
					FirstSeenAt: time.Now(),
				})
			}
		}
	}

	return findings, scanner.Err()
}

func buildRules() []Rule {
	isNonDevFile := func(path string) bool {
		lower := strings.ToLower(path)
		// Skip files that are explicitly development configs
		devIndicators := []string{
			".dev.", ".development.", ".local.",
			"dev.env", "development.env",
			".example", ".sample", ".template",
		}
		for _, ind := range devIndicators {
			if strings.Contains(lower, ind) {
				return false
			}
		}
		return true
	}

	isConfigOrSource := func(path string) bool {
		ext := strings.ToLower(filepath.Ext(path))
		sourceExts := map[string]bool{
			".js": true, ".ts": true, ".jsx": true, ".tsx": true,
			".py": true, ".rb": true, ".go": true, ".java": true,
			".json": true, ".yaml": true, ".yml": true, ".toml": true,
			".env": true, ".conf": true, ".cfg": true, ".ini": true,
			".xml": true, ".properties": true,
		}
		return sourceExts[ext]
	}

	return []Rule{
		// Debug flags in non-dev files
		{
			Name:        "Debug mode enabled",
			Regex:       regexp.MustCompile(`(?i)(?:DEBUG|debug)\s*[=:]\s*(?:true|1|yes|on)`),
			Severity:    models.SeverityMedium,
			Category:    "debug",
			Description: "Debug mode is enabled which may leak sensitive information",
			Remediation: "Disable debug mode in production configurations",
			FileFilter: func(path string) bool {
				return isNonDevFile(path) && isConfigOrSource(path)
			},
		},
		{
			Name:        "NODE_ENV set to development",
			Regex:       regexp.MustCompile(`NODE_ENV\s*[=:]\s*["']?development["']?`),
			Severity:    models.SeverityMedium,
			Category:    "debug",
			Description: "NODE_ENV is set to development which may enable debug features",
			Remediation: "Ensure NODE_ENV is set to 'production' in production deployments",
			FileFilter:  isNonDevFile,
		},
		// Insecure CORS
		{
			Name:        "Wildcard CORS origin",
			Regex:       regexp.MustCompile(`(?i)Access-Control-Allow-Origin\s*[=:]\s*["']?\*["']?`),
			Severity:    models.SeverityHigh,
			Category:    "cors",
			Description: "CORS is configured to allow all origins, enabling cross-site attacks",
			Remediation: "Restrict Access-Control-Allow-Origin to specific trusted domains",
			FileFilter:  isConfigOrSource,
		},
		{
			Name:        "CORS allow all origins (code)",
			Regex:       regexp.MustCompile(`cors\s*\(\s*\{\s*origin\s*:\s*["']\*["']`),
			Severity:    models.SeverityHigh,
			Category:    "cors",
			Description: "CORS middleware configured with wildcard origin",
			Remediation: "Configure CORS with specific allowed origins instead of '*'",
			FileFilter:  isConfigOrSource,
		},
		{
			Name:        "CORS credentials with wildcard",
			Regex:       regexp.MustCompile(`(?i)Access-Control-Allow-Credentials\s*[=:]\s*true`),
			Severity:    models.SeverityMedium,
			Category:    "cors",
			Description: "CORS credentials enabled which may expose user sessions if combined with permissive origins",
			Remediation: "Ensure credentials are only allowed with specific trusted origins",
			FileFilter:  isConfigOrSource,
		},
		// Security headers
		{
			Name:        "HSTS disabled",
			Regex:       regexp.MustCompile(`(?i)(?:hsts|strict.transport.security)\s*[=:]\s*(?:false|off|disabled|0)`),
			Severity:    models.SeverityMedium,
			Category:    "headers",
			Description: "HTTP Strict Transport Security is disabled",
			Remediation: "Enable HSTS with a minimum max-age of 31536000 seconds",
			FileFilter:  isConfigOrSource,
		},
		{
			Name:        "X-Frame-Options disabled",
			Regex:       regexp.MustCompile(`(?i)(?:x.frame.options|frameguard)\s*[=:]\s*(?:false|off|disabled|ALLOWALL)`),
			Severity:    models.SeverityMedium,
			Category:    "headers",
			Description: "X-Frame-Options is disabled, allowing clickjacking attacks",
			Remediation: "Set X-Frame-Options to DENY or SAMEORIGIN",
			FileFilter:  isConfigOrSource,
		},
		{
			Name:        "CSP disabled",
			Regex:       regexp.MustCompile(`(?i)(?:content.security.policy|contentSecurityPolicy)\s*[=:]\s*(?:false|off|disabled)`),
			Severity:    models.SeverityMedium,
			Category:    "headers",
			Description: "Content Security Policy is disabled",
			Remediation: "Configure a Content Security Policy to prevent XSS and data injection",
			FileFilter:  isConfigOrSource,
		},
		// Insecure cookies
		{
			Name:        "Cookie secure flag disabled",
			Regex:       regexp.MustCompile(`(?i)secure\s*[=:]\s*false`),
			Severity:    models.SeverityHigh,
			Category:    "cookies",
			Description: "Cookie secure flag is disabled, allowing transmission over HTTP",
			Remediation: "Set secure: true on all session and authentication cookies",
			FileFilter:  isConfigOrSource,
		},
		{
			Name:        "Cookie httpOnly flag disabled",
			Regex:       regexp.MustCompile(`(?i)httpOnly\s*[=:]\s*false`),
			Severity:    models.SeverityHigh,
			Category:    "cookies",
			Description: "Cookie httpOnly flag is disabled, allowing JavaScript access to cookies",
			Remediation: "Set httpOnly: true on all session and authentication cookies",
			FileFilter:  isConfigOrSource,
		},
		// Verbose error exposure
		{
			Name:        "Stack trace in error response",
			Regex:       regexp.MustCompile(`(?i)(?:res|response)\.(?:json|send)\s*\(.*(?:stack|stackTrace|err\.stack)`),
			Severity:    models.SeverityMedium,
			Category:    "error_exposure",
			Description: "Stack trace may be exposed in API error responses",
			Remediation: "Remove stack traces from production error responses; log them server-side instead",
			FileFilter:  isConfigOrSource,
		},
		{
			Name:        "Express error handler exposes stack",
			Regex:       regexp.MustCompile(`(?i)(?:error|err)\.stack`),
			Severity:    models.SeverityLow,
			Category:    "error_exposure",
			Description: "Error stack trace reference found which could be exposed to clients",
			Remediation: "Ensure stack traces are only logged server-side, not sent in responses",
			FileFilter: func(path string) bool {
				ext := strings.ToLower(filepath.Ext(path))
				return ext == ".js" || ext == ".ts" || ext == ".jsx" || ext == ".tsx"
			},
		},
	}
}

func shouldSkipDir(name string) bool {
	skip := map[string]bool{
		".git": true, "node_modules": true, "vendor": true,
		"__pycache__": true, ".tox": true, ".venv": true,
		"dist": true, "build": true,
	}
	return skip[name]
}

func shouldSkipFile(path string, info os.FileInfo) bool {
	if info.Size() > 1024*1024 {
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
