// Package patterns detects risky code patterns in source code.
package patterns

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

// Rule defines a code pattern security check.
type Rule struct {
	Name        string
	Regex       *regexp.Regexp
	Severity    models.Severity
	Category    string
	Description string
	Remediation string
	// FileFilter limits which files this rule applies to (nil = all source files).
	FileFilter func(path string) bool
}

// Scan walks the repository and detects risky code patterns.
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
				slog.Debug("failed to scan file for patterns", "file", relPath, "error", err)
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
			slog.Debug("failed to scan file for patterns", "file", relPath, "error", scanErr)
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

		// Skip comment-only lines
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "//") || strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, "*") {
			continue
		}

		for _, r := range rules {
			if r.FileFilter != nil && !r.FileFilter(relPath) {
				continue
			}
			if r.Regex.MatchString(line) {
				findings = append(findings, models.Finding{
					Source:      models.SourcePattern,
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
	isJSTS := func(path string) bool {
		ext := strings.ToLower(filepath.Ext(path))
		return ext == ".js" || ext == ".ts" || ext == ".jsx" || ext == ".tsx" || ext == ".mjs" || ext == ".cjs"
	}

	isPython := func(path string) bool {
		return strings.ToLower(filepath.Ext(path)) == ".py"
	}

	isJSTSOrPython := func(path string) bool {
		return isJSTS(path) || isPython(path)
	}

	isSourceCode := func(path string) bool {
		ext := strings.ToLower(filepath.Ext(path))
		sourceExts := map[string]bool{
			".js": true, ".ts": true, ".jsx": true, ".tsx": true,
			".py": true, ".rb": true, ".go": true, ".java": true,
			".php": true, ".cs": true, ".rs": true, ".mjs": true, ".cjs": true,
		}
		return sourceExts[ext]
	}

	isNonConfig := func(path string) bool {
		lower := strings.ToLower(path)
		configIndicators := []string{
			"config", ".env", "settings", "constants",
			"webpack", "vite", "babel", "jest",
			"tsconfig", "package.json", "docker",
		}
		for _, ind := range configIndicators {
			if strings.Contains(lower, ind) {
				return false
			}
		}
		return isSourceCode(path)
	}

	return []Rule{
		// eval() usage
		{
			Name:        "eval() usage",
			Regex:       regexp.MustCompile(`\beval\s*\(`),
			Severity:    models.SeverityHigh,
			Category:    "code_injection",
			Description: "Use of eval() can lead to code injection attacks",
			Remediation: "Replace eval() with a safe alternative such as JSON.parse() or a sandboxed execution environment",
			FileFilter:  isJSTSOrPython,
		},
		{
			Name:        "Function constructor (eval equivalent)",
			Regex:       regexp.MustCompile(`new\s+Function\s*\(`),
			Severity:    models.SeverityHigh,
			Category:    "code_injection",
			Description: "new Function() is equivalent to eval() and allows code injection",
			Remediation: "Avoid dynamic code execution; use static functions or safe alternatives",
			FileFilter:  isJSTS,
		},
		// Insecure crypto
		{
			Name:        "MD5 usage",
			Regex:       regexp.MustCompile(`(?i)(?:createHash|hashlib\.md5|MessageDigest\.getInstance)\s*\(\s*["'](?i:md5)["']`),
			Severity:    models.SeverityMedium,
			Category:    "weak_crypto",
			Description: "MD5 is cryptographically broken and should not be used for security purposes",
			Remediation: "Use SHA-256 or SHA-3 for hashing; use bcrypt/scrypt/argon2 for passwords",
			FileFilter:  isSourceCode,
		},
		{
			Name:        "SHA1 for security",
			Regex:       regexp.MustCompile(`(?i)(?:createHash|hashlib\.sha1|MessageDigest\.getInstance)\s*\(\s*["'](?i:sha1?)["']`),
			Severity:    models.SeverityMedium,
			Category:    "weak_crypto",
			Description: "SHA-1 is deprecated for security purposes",
			Remediation: "Use SHA-256 or SHA-3 instead of SHA-1",
			FileFilter:  isSourceCode,
		},
		{
			Name:        "Math.random() for crypto",
			Regex:       regexp.MustCompile(`Math\.random\s*\(\s*\)`),
			Severity:    models.SeverityHigh,
			Category:    "weak_crypto",
			Description: "Math.random() is not cryptographically secure",
			Remediation: "Use crypto.randomBytes() or crypto.getRandomValues() for security-sensitive random generation",
			FileFilter:  isJSTS,
		},
		// SQL concatenation
		{
			Name:        "SQL string concatenation",
			Regex:       regexp.MustCompile(`(?i)(?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER)\s+.*["']\s*\+`),
			Severity:    models.SeverityHigh,
			Category:    "sql_injection",
			Description: "SQL query built using string concatenation, which is vulnerable to SQL injection",
			Remediation: "Use parameterized queries or prepared statements instead of string concatenation",
			FileFilter:  isSourceCode,
		},
		{
			Name:        "SQL template literal",
			Regex:       regexp.MustCompile("(?i)(?:SELECT|INSERT|UPDATE|DELETE)\\s+.*`.*\\$\\{"),
			Severity:    models.SeverityHigh,
			Category:    "sql_injection",
			Description: "SQL query built using template literals with interpolation",
			Remediation: "Use parameterized queries or an ORM instead of string interpolation in SQL",
			FileFilter:  isJSTS,
		},
		{
			Name:        "SQL f-string (Python)",
			Regex:       regexp.MustCompile(`(?i)f["'](?:SELECT|INSERT|UPDATE|DELETE)\s+`),
			Severity:    models.SeverityHigh,
			Category:    "sql_injection",
			Description: "SQL query built using f-string interpolation",
			Remediation: "Use parameterized queries with %s placeholders or an ORM",
			FileFilter:  isPython,
		},
		// Command injection
		{
			Name:        "child_process exec",
			Regex:       regexp.MustCompile(`(?:child_process|require\s*\(\s*["']child_process["']\s*\)).*\.exec\s*\(`),
			Severity:    models.SeverityHigh,
			Category:    "command_injection",
			Description: "child_process.exec() can be vulnerable to command injection",
			Remediation: "Use child_process.execFile() with an argument array instead of exec() with shell interpolation",
			FileFilter:  isJSTS,
		},
		{
			Name:        "shell exec with concatenation",
			Regex:       regexp.MustCompile(`(?:exec|execSync|spawn)\s*\([^)]*\+`),
			Severity:    models.SeverityHigh,
			Category:    "command_injection",
			Description: "Shell command built with string concatenation is vulnerable to injection",
			Remediation: "Use execFile() or spawn() with an argument array; validate and escape all user input",
			FileFilter:  isJSTS,
		},
		{
			Name:        "os.system() usage (Python)",
			Regex:       regexp.MustCompile(`os\.system\s*\(`),
			Severity:    models.SeverityHigh,
			Category:    "command_injection",
			Description: "os.system() executes commands through the shell and is vulnerable to injection",
			Remediation: "Use subprocess.run() with a list of arguments and shell=False",
			FileFilter:  isPython,
		},
		{
			Name:        "subprocess with shell=True",
			Regex:       regexp.MustCompile(`subprocess\.(?:call|run|Popen)\s*\(.*shell\s*=\s*True`),
			Severity:    models.SeverityHigh,
			Category:    "command_injection",
			Description: "subprocess with shell=True is vulnerable to shell injection",
			Remediation: "Use subprocess.run() with a list of arguments and shell=False",
			FileFilter:  isPython,
		},
		// Hardcoded IPs/URLs
		{
			Name:        "Hardcoded IP address",
			Regex:       regexp.MustCompile(`["']\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}["']`),
			Severity:    models.SeverityLow,
			Category:    "hardcoded_values",
			Description: "Hardcoded IP address found; use configuration or environment variables",
			Remediation: "Move IP addresses to configuration files or environment variables",
			FileFilter:  isNonConfig,
		},
		// Hardcoded URL detection omitted — Go regexp lacks negative lookahead,
		// and the rule is low-severity/noisy. Covered by the Node.js fallback scanner.
		// Insecure deserialization
		{
			Name:        "Unsafe deserialization (Python pickle)",
			Regex:       regexp.MustCompile(`pickle\.loads?\s*\(`),
			Severity:    models.SeverityHigh,
			Category:    "deserialization",
			Description: "pickle.load() on untrusted data can execute arbitrary code",
			Remediation: "Use JSON or a safe serialization format instead of pickle for untrusted data",
			FileFilter:  isPython,
		},
		// innerHTML usage
		{
			Name:        "innerHTML assignment",
			Regex:       regexp.MustCompile(`\.innerHTML\s*=`),
			Severity:    models.SeverityMedium,
			Category:    "xss",
			Description: "Direct innerHTML assignment can lead to XSS if content is not sanitized",
			Remediation: "Use textContent for text or a sanitization library (DOMPurify) for HTML content",
			FileFilter:  isJSTS,
		},
		{
			Name:        "dangerouslySetInnerHTML",
			Regex:       regexp.MustCompile(`dangerouslySetInnerHTML`),
			Severity:    models.SeverityMedium,
			Category:    "xss",
			Description: "dangerouslySetInnerHTML can lead to XSS if content is not sanitized",
			Remediation: "Ensure all data passed to dangerouslySetInnerHTML is sanitized with DOMPurify or similar",
			FileFilter:  isJSTS,
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
