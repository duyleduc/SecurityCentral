# SecurityCentral — Product Specification (v1)

## 1. Purpose
SecurityCentral is a lightweight infrastructure security and monitoring platform for small companies. It provides a unified view of:
- Code repositories (security scanning and scoring)
- Servers/VMs (health + security posture + real‑time monitoring)
- Domains (SSL/TLS, DNS security, uptime)

The product is designed for non‑security teams. It emphasizes clarity, low setup friction, and actionable alerts.

---

## 2. Core Principles
- **Simple by default**: minimal setup, opinionated defaults.
- **Actionable over exhaustive**: focus on what users can fix.
- **Unified view**: projects aggregate repositories, servers, and domains.
- **Explainable security**: clear scores with “why” behind them.

---

## 3. Entity Model

### 3.1 Project
A project groups all assets for a product/team.
- `project_id`
- `name`
- `description`
- `tags`

### 3.2 Repository
- `repo_id`
- `project_id`
- `provider` (GitHub, GitLab, Bitbucket)
- `repo_url`
- `default_branch`
- `last_scan_at`
- `score`

### 3.3 Server
- `server_id`
- `project_id`
- `hostname`
- `ip`
- `os`
- `agent_status`
- `last_heartbeat_at`
- `score`

### 3.4 Domain
- `domain_id`
- `project_id`
- `domain_name`
- `last_check_at`
- `score`

---

## 4. Modules and Scans

### 4.1 Code Scanner (Repositories)
**Goal:** Detect common security risks in source code and dependencies.

#### 4.1.1 Scans
1. **Dependency vulnerabilities (SCA)**
   - Direct + transitive dependencies
   - CVE severity classification
2. **Outdated libraries**
   - Packages with available security patches
3. **Secrets exposure**
   - API keys, tokens, passwords, private keys
4. **Unsafe configurations**
   - Debug flags enabled, insecure CORS
5. **Known risky patterns**
   - `eval`, insecure crypto, SQL concat
6. **License risks (optional phase 2)**
   - Incompatible or risky licenses

#### 4.1.2 Output
- Repository Security Score (0–100)
- Issue list with:
  - Severity
  - File/path or package
  - Recommended fix

---

### 4.2 Server Scanner (VMs/Servers)
**Goal:** Provide server security posture + operational health.

#### 4.2.1 Baseline Security Scans
1. **OS version & patch status**
2. **Open ports & exposed services**
3. **SSH configuration safety**
   - Root login, password auth
4. **Firewall status**
5. **User access risk**
   - Unknown users, no MFA, unused privileges
6. **File permission risks**
   - World‑writable critical files
7. **Critical service configuration**
   - TLS disabled, insecure defaults

#### 4.2.2 Health & Metrics
- CPU, RAM, Disk usage
- Disk IO wait
- Network throughput

---

### 4.3 Domain Scanner (DNS / SSL / Uptime)
**Goal:** Ensure domain security and availability.

#### 4.3.1 Scans
1. **SSL certificate validity**
   - Expiry, issuer, chain validity
2. **TLS configuration**
   - Weak ciphers, outdated versions
3. **DNS security**
   - SPF, DKIM, DMARC
4. **Subdomain exposure**
   - Dangling DNS / takeover risks
5. **HTTP security headers**
   - HSTS, CSP, X‑Frame‑Options
6. **Uptime monitoring**
   - HTTP status, response time

---

## 5. Real‑Time Server Monitoring (Configurable)
**Goal:** Provide optional live monitoring with configurable alert rules.

### 5.1 Modes
- **Off**: periodic scans only
- **Standard**: metrics every X minutes + threshold alerts
- **Real‑time**: streaming metrics + instant alerts

### 5.2 Default Alert Rules

**Performance & Capacity**
1. `CPU High`
   - Trigger: CPU > 85% for 5 minutes
   - Critical: CPU > 95% for 2 minutes
2. `Memory High`
   - Trigger: RAM > 85% for 5 minutes
   - Critical: RAM > 95% for 2 minutes
3. `Disk Full`
   - Trigger: Disk usage > 90% for 10 minutes
   - Critical: > 95% for 5 minutes
4. `Disk IO Saturation`
   - Trigger: IO wait > 20% for 5 minutes
   - Critical: > 40% for 2 minutes

**Availability**
5. `Server Unreachable`
   - Trigger: 3 failed heartbeats in a row
   - Critical: > 10 minutes unreachable
6. `Agent Offline`
   - Trigger: no metrics for 5 minutes
   - Critical: no metrics for 30 minutes

**Security‑Relevant Anomalies (lightweight)**
7. `Unexpected Spike`
   - Trigger: CPU/RAM jumps > 40% within 1 minute
   - Critical: spike repeats 3 times in 15 minutes
8. `New Public Port`
   - Trigger: newly open port exposed externally
   - Critical: port is high‑risk (22, 3389, 3306, 5432)
9. `Suspicious Process`
   - Trigger: unknown process consumes > 50% CPU for 3 minutes
   - Critical: repeated spike + process not whitelisted

**Storage Integrity**
10. `Disk Errors`
   - Trigger: disk read/write errors detected
   - Critical: errors increasing rapidly

**Service Health**
11. `Critical Service Down`
   - Trigger: monitored service not running for 1 minute
   - Critical: down > 5 minutes

### 5.3 User Configuration Options
- Sampling interval (1 / 5 / 15 minutes)
- Alert thresholds
- Alert channels (email, Slack, webhook)
- Quiet hours / maintenance windows
- “Only critical alerts” toggle

---

## 6. Scoring Model (High‑Level)
Each asset (repo/server/domain) has a **Security Score (0–100)** based on:
- Severity of findings
- Recency of patches
- Exposure level (public‑facing vs internal)
- Stability (repeat alerts, unresolved issues)

The score must be **explainable** with a clear “why”.

---

## 7. Dashboard & UX
- Project‑level overview (health snapshot)
- Clear status indicators (Good / Warning / Critical)
- Drill‑down pages for each asset
- Non‑security friendly language
- Minimal setup wizard

---

## 8. MVP vs Phase 2

### MVP
- Repo dependency scan
- Secret detection
- Server metrics + thresholds
- Server patch/OS visibility
- Domain SSL + uptime
- Basic scoring

### Phase 2
- Advanced static analysis
- Compliance reports
- Automated remediation
- Team access roles

---

## 9. Success Criteria
- Onboarding < 15 minutes
- Actionable alerts < 10 per week per project
- At least 80% of issues have clear next steps
- “Explainable score” visible within 1 click
