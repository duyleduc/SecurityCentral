# SecurityCentral — Code Scanning Architecture

## Overview

When you click "Trigger Scan" or a push webhook fires, the platform runs a three-stage scanning pipeline on the repository:

```
Clone repo → SCA (dependency audit) → SAST (code analysis) → Secret scan → Ingest findings
```

Each stage runs independently and finds different classes of vulnerabilities.

---

## Scan Pipeline

### Stage 1: Dependency Scanning (SCA)

**What it finds:** Known CVEs in your project's dependencies.

**How it works:** Detects lockfiles in the cloned repo and runs the ecosystem's native audit tool:

| Lockfile detected | Tool used | Database |
|---|---|---|
| `package-lock.json` / `yarn.lock` | `npm audit --json` | npm Advisory Database (GitHub) |
| `requirements.txt` | `pip-audit --json` | PyPI Advisory Database (OSV) |
| `composer.lock` | `composer audit --json` | Packagist Advisories |
| `Gemfile.lock` | `bundle-audit --json` | RubySec Advisory Database |

**Example finding:**
```
Title:    Prototype Pollution in lodash@4.17.20
Severity: high
CVE:      CVE-2021-23337
CVSS:     7.2
Fix:      npm install lodash@4.17.21
```

**What it extracts per vulnerability:**
- Package name and affected version range
- CVE ID (or GHSA ID)
- CVSS score (when available)
- Severity (critical/high/medium/low)
- Fix version and upgrade command
- Whether it's auto-fixable

**Requirements:** The respective package manager must be installed on the platform server:
- Node.js/npm (required for npm audit)
- Python/pip + `pip-audit` (`pip install pip-audit`)
- PHP/Composer (for composer audit)
- Ruby/Bundler + `bundle-audit` (`gem install bundle-audit`)

---

### Stage 2: SAST — Static Application Security Testing

**What it finds:** Code-level vulnerabilities: SQL injection, XSS, SSRF, insecure crypto, path traversal, and 2000+ other patterns.

**How it works:** Runs [Semgrep](https://semgrep.dev) with `--config auto`, which automatically selects the best security rules for the detected languages/frameworks.

**Rulesets applied (auto-detected):**

| Ruleset | What it detects |
|---|---|
| OWASP Top 10 | SQL injection, XSS, SSRF, broken auth, security misconfiguration |
| Security Audit | Insecure crypto (MD5/SHA1), hardcoded secrets, unsafe deserialization |
| Language-specific | Express/Django/Flask/Rails/Spring security patterns |
| Framework-specific | React dangerouslySetInnerHTML, JWT without verification, etc. |

**Supported languages:**
Python, JavaScript/TypeScript, Java, Go, Ruby, PHP, C/C++, Rust, Kotlin, Swift, Scala, and more.

**Example findings:**

```
Title:    SQL Injection in src/api/users.ts:42
Severity: high
CWE:      CWE-89
OWASP:    A03:2021 - Injection
Code:     db.query(`SELECT * FROM users WHERE id = ${req.params.id}`)
Fix:      Use parameterized queries: db.query('SELECT * FROM users WHERE id = $1', [req.params.id])
```

```
Title:    Cross-Site Scripting (XSS) in src/views/profile.tsx:18
Severity: medium
CWE:      CWE-79
Code:     <div dangerouslySetInnerHTML={{__html: userInput}} />
Fix:      Use a sanitization library like DOMPurify
```

**What it extracts per finding:**
- Rule ID and vulnerability class
- File path, line number, column
- CWE identifier(s)
- OWASP category
- Matched source code snippet
- Suggested fix (when available)
- Confidence level (HIGH/MEDIUM/LOW)
- References (docs, blog posts, CVE links)

**Requirements:** Semgrep must be installed:
```bash
# macOS
brew install semgrep

# Linux/pip
pip install semgrep

# Docker
docker pull returntocorp/semgrep
```

If Semgrep is not installed, SAST is skipped gracefully — dependency and secret scans still run.

---

### Stage 3: Secret Detection

**What it finds:** Hardcoded credentials, API keys, tokens, private keys, and database URIs in source code.

**How it works:** Scans every source file against 13 regex patterns:

| Pattern | Example | Severity |
|---|---|---|
| AWS Access Key | `AKIAIOSFODNN7EXAMPLE` | Critical |
| AWS Secret Key | `aws_secret_access_key = wJalrX...` | Critical |
| Stripe Secret Key | `sk_live_...` | Critical |
| RSA Private Key | `-----BEGIN RSA PRIVATE KEY-----` | Critical |
| Private Key (generic) | `-----BEGIN PRIVATE KEY-----` | Critical |
| GitHub PAT | `ghp_...` | High |
| GitLab Token | `glpat-...` | High |
| Slack Token | `xoxb-...` | High |
| GCP API Key | `AIza...` | High |
| SendGrid Key | `SG....` | High |
| npm Token | `npm_...` | High |
| PostgreSQL URI | `postgres://user:pass@host` | High |
| MongoDB URI | `mongodb+srv://user:pass@host` | High |

**Skipped automatically:**
- `.git/` directory
- `node_modules/`, `vendor/`, `dist/`, `build/`
- Lockfiles (package-lock.json, yarn.lock, etc.)
- Binary files (.png, .jpg, .zip, .exe, etc.)
- Files > 1MB
- Test fixtures and testdata directories

**Example finding:**
```
Title:    AWS Access Key detected in src/config/aws.ts
Severity: critical
Line:     14
Action:   Remove the secret and rotate the credential immediately
```

---

## Scan Lifecycle

```
┌─────────┐     ┌─────────┐     ┌───────────────┐     ┌──────────┐
│ pending  │────►│ running │────►│  completed     │     │  failed  │
│          │     │         │     │  (N findings)  │     │  (error) │
└─────────┘     └────┬────┘     └───────────────┘     └──────────┘
                     │                                       ▲
                     └── on error ───────────────────────────┘
```

**Timing:**
- Clone: 1–10 seconds (shallow clone, depth=1)
- SCA (npm audit): 2–15 seconds
- SAST (Semgrep): 10–120 seconds depending on repo size
- Secret scan: 1–30 seconds depending on file count
- **Total: 15–180 seconds typical**

**Resource limits:**
- Clone timeout: 2 minutes
- Audit tool timeout: 2 minutes each
- Semgrep timeout: 5 minutes, 60s per-rule timeout
- File size limit: 1MB per file
- Max buffer: 50MB for tool output
- Temp directory cleaned up after scan

---

## How to Trigger a Scan

### Manual (Dashboard)
1. Go to Assets → Repositories
2. Click on a repository
3. Click "Trigger Scan"

### Automatic (Webhook)
Push to the default branch triggers a scan automatically when GitHub/GitLab/Bitbucket is connected.

### API
```bash
POST /api/v1/repositories/:id/scan
Authorization: Bearer <jwt>
```

---

## Installing Scan Dependencies

For the full scanning pipeline, install these on the platform server:

```bash
# Required: Node.js (already installed)
# npm audit runs automatically

# Recommended: Semgrep (SAST)
pip install semgrep
# or: brew install semgrep

# Optional: Python dependency scanning
pip install pip-audit

# Optional: PHP dependency scanning
# composer is usually already installed with PHP projects

# Optional: Ruby dependency scanning
gem install bundler-audit
```

**Minimum viable setup:** Just Node.js — `npm audit` + secret scanning work out of the box.

**Full setup:** Node.js + Semgrep covers 95% of use cases (SCA + SAST + secrets).

---

## Finding Types in the Dashboard

| Source | Type | Icon | Description |
|---|---|---|---|
| SCA | `package_vulnerability` | 📦 | Known CVE in a dependency |
| SAST | `sast` | 🔍 | Code-level vulnerability (injection, XSS, etc.) |
| Secrets | `secret` | 🔑 | Hardcoded credential in source code |

Each finding includes:
- **Severity** (critical/high/medium/low/info)
- **File and line number** (clickable in dashboard)
- **CVE/CWE identifier** (when applicable)
- **Remediation** (upgrade command, code fix suggestion)
- **Auto-fixable flag** (for dependency upgrades)

---

## Architecture

```
Dashboard                        Platform API                     Worker
   │                                │                               │
   │  POST /repos/:id/scan         │                               │
   │──────────────────────────────►│                               │
   │                                │  create scan (pending)        │
   │                                │  enqueue scan-orchestration   │
   │                                │──────────────────────────────►│
   │                                │                               │
   │                                │                  ┌────────────┤
   │                                │                  │ 1. Clone   │
   │                                │                  │ 2. npm audit│
   │                                │                  │ 3. Semgrep │
   │                                │                  │ 4. Secrets │
   │                                │                  │ 5. Ingest  │
   │                                │                  └────────────┤
   │                                │                               │
   │                                │◄──────────────────────────────│
   │                                │  scan completed (N findings)  │
   │  WebSocket: scan:completed     │                               │
   │◄──────────────────────────────│                               │
```

All findings go through the same ingestion pipeline (`ingestFindings`) as agent-submitted findings, which handles:
- Deduplication (by CVE+asset or title+asset)
- Auto-resolution of stale findings
- Elasticsearch sync
- Notification dispatch for critical/high findings
