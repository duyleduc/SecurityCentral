# Product Specification: SecurityCentral Platform

**Positioning:** "The all-in-one security platform: Code scanning + server scanning + certificate monitoring + CVE correlation, powered by AI agents. Replace Snyk + Tenable + Dependabot + certbot."

---

## 1. VISION

Build a **unified security scanning and monitoring platform** with proprietary scanning engines + AI-powered intelligence for prioritization and remediation across code, infrastructure, and certificates.

**Why it's defensible:**
- Proprietary scanning engines (not just API wrappers)
- AI agents provide insights that individual tools can't
- Single agent across entire stack (vs. point solutions)
- Real-time monitoring + correlation = unique value

---

## 2. CORE PRODUCT PILLARS

### **Pillar 1: Code Security Scanner (Replace Snyk/Dependabot)**

**What it does:**
- Scans dependencies (SCA) for known vulnerabilities
- Scans code for SAST issues (SQL injection, XSS, hardcoded secrets, etc.)
- Tracks license compliance (GPL, proprietary, etc.)
- Supports: npm, pip, Maven, Go, Rust, Cargo, Gem, Composer, NuGet, etc.

**How it works:**
- Lightweight CLI agent installed in CI/CD pipeline
- Real-time scanning: every commit/PR
- Local scanning (data doesn't leave your infrastructure) OR cloud API
- Integrates with GitHub, GitLab, Bitbucket workflows
- Auto-creates PRs for dependency updates

**Defensibility:**
- Our proprietary vulnerability database (sourced from NVD + private research + GitHub + security researchers)
- Faster zero-day discovery than Snyk (claim: find vulns 30 days before NVD when possible)
- ML-powered: learns which vulns actually matter for YOUR codebase (reachability analysis)

**Key Features:**
- Dependency scanning + auto-fix PRs
- SAST: detect secrets, injection flaws, insecure crypto
- License compliance enforcement
- Soft package detection (software bill of materials)
- Container image scanning (detect vulnerable base images)
- IaC scanning (Terraform, CloudFormation, Kubernetes manifests)

---

### **Pillar 2: Infrastructure Scanner (Replace Tenable/Qualys)**

**What it does:**
- Discovers all servers, VMs, cloud instances, containers
- Scans for OS vulnerabilities, missing patches, misconfigurations
- Completes network maps, open port detection
- Compliance checking (CIS benchmarks, PCI-DSS, SOC 2, HIPAA)

**How it works:**

**Option A: Agent-Based (Recommended for 80% of cases)**
- Lightweight agent (1MB binary, <1% CPU) installed on each server
- Runs vulnerability scans locally (no data exfil, privacy-first)
- Reports findings to central platform
- Agent auto-updates vulnerabilities database (daily)
- Minimal setup: `curl | bash` or deploy via config management

**Option B: SSH-Based (For legacy/non-agent infra)**
- Provide SSH credentials (or API keys for cloud providers)
- Platform connects via SSH, audits configuration, detects vulnerabilities
- No agent installation required
- Works for: bare metal, legacy VMs, cloud instances (EC2, GCP, Azure)
- Less frequent scanning (hourly vs. real-time)

**Option C: Cloud Native**
- AWS: Read from EC2 inventory, Systems Manager, inspect CloudTrail
- GCP: GKE inspection, Cloud Asset Inventory integration
- Azure: AzureRM API, scan VMs in-place

**Defensibility:**
- Fast, lightweight agent (competitors = resource hogs)
- Privacy-first: scanning happens locally when possible
- Cross-cloud support (not locked to AWS/Azure)
- Real-time vulnerability feeds (not weekly updates like competitors)

**Key Features:**
- OS package vulnerability detection (all major OS: Ubuntu, CentOS, RHEL, Alpine, etc.)
- Patch compliance tracking + remediation suggestions
- Misconfiguration detection (open ports, weak SSH keys, unencrypted storage, etc.)
- CIS benchmark scanning (automation of compliance checklists)
- Process and service inventory (what's running?)
- Performance monitoring (detect compromised processes consuming resources)
- Supply chain scanning: detect unauthorized/suspicious packages

---

### **Pillar 3: Certificate & SSL Monitoring**

**What it does:**
- Automatically discovers all SSL certificates across infrastructure
- Monitors expiration dates
- Detects weak algorithms (SSLv3, TLS 1.0, self-signed)
- Tracks certificate chains (are all intermediates valid?)
- Compliance: validates against best practices (no 1024-bit RSA, etc.)

**How it works:**
- Scanner discovers certificates from:
  - Load balancers (ALB, NLB, Cloudfront, GCP LB, etc.)
  - Web servers (nginx, Apache config scan)
  - API endpoints (HTTPS discovery)
  - Kubernetes secrets
  - DNS records (certificate transparency logs)
- Monitors expiration dates → sends alerts (90, 60, 30, 14, 7 days before expiry)
- Validates chain (root → intermediate → leaf)
- Detects algorithm weaknesses, mismatches

**Defensibility:**
- Automated discovery (competitors make you input URLs manually)
- Works across infrastructure types (cloud, on-prem, hybrid)
- Real-time expiration warnings (prevent outages)
- Proactive: find unused/abandoned certificates before they expire

**Key Features:**
- Automatic certificate discovery
- Expiration tracking + alerting
- Chain validation
- Algorithm strength assessment
- Compliance checks (PCI-DSS: TLS 1.2+, no weak ciphers)
- Multi-domain tracking (SANs, wildcard certificates)

---

### **Pillar 4: CVE Correlation & Intelligence (The AI Agent Layer)**

**What it does:**
This is where **AI agents add the magic** — making raw vulnerabilities actionable.

**Problem it solves:**
- Same CVE found in your code AND server infrastructure → Are they related?
- Is this CVE in a code path you actually use?
- Which service is most at risk?
- What's the fastest way to remediate this across 50 services?

**AI Agents:**

#### **Agent 1: Correlation Engine**
- Input: CVEs from code scanner + server scanner + certificates
- Job: Find relationships
  - "Log4j found in your code AND your Java servers are vulnerable"
  - "Your app depends on OpenSSL 1.1.0, AND your Linux servers have the same issue"
  - "SSL cert expires in 14 days AND load balancer points to it"
- Output: Unified risk view (not separate code/infra risks)

#### **Agent 2: Intelligent Prioritization**
- Risk score = (CVSS × exploit_maturity × reachability × criticality × business_context)
- Reachability: "This SQL injection exists in the code, but the vulnerable function is never called"
- Business context: "This service processes payments (critical), so this Medium CVSS = treat as High"
- Environment context: "Dev environment CVE < production CVE"

#### **Agent 3: Remediation Path Finder**
- Given a vulnerability, recommend fastest fix
  - "Log4j: Option A) update 50 services (2 days), Option B) patch-only on legacy services (4 hours)"
  - "OS patch available: rolling deploy to fleet"
  - "Certificate expires: renewal process takes 2 hours"
- Auto-create remediation tasks: PRs for code, deployment tickets for infra, cert renewal jobs

#### **Agent 4: Compliance Reporter**
- Auto-generate compliance evidence
  - "We scanned all systems on date X, found Y vulnerabilities, remediated Z, evidence: [audit trail]"
  - "SOC 2 requirement: document vulnerability lifecycle → here's your proof"
  - Map findings to: CIS Control, PCI-DSS requirement, HIPAA control

---

## 3. PRODUCT ARCHITECTURE

```
┌────────────────────────────────────────────────────────┐
│                    CENTRAL PLATFORM                    │
│  (Web dashboard + API + AI orchestration)              │
└────────────────────────────────────────────────────────┘
                         ↓
     ┌───────────────────┼───────────────────┐
     ↓                   ↓                   ↓
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ CODE SCAN    │   │ INFRA SCAN   │   │ CERT MONITOR │
│ ENGINE       │   │ ENGINE       │   │ ENGINE       │
├──────────────┤   ├──────────────┤   ├──────────────┤
│• Dependency  │   │• Agent-based │   │• Auto-       │
│• SAST        │   │• SSH/API     │   │  discover    │
│• Container   │   │• Cloud API   │   │• Monitor     │
│• IaC         │   │• Compliance  │   │• Alert       │
└──────────────┘   └──────────────┘   └──────────────┘
        ↓                   ↓                   ↓
┌────────────────────────────────────────────────────────┐
│         UNIFIED FINDINGS DB (Normalized)               │
│  (All CVEs in one format, with metadata)               │
└────────────────────────────────────────────────────────┘
        ↓
┌────────────────────────────────────────────────────────┐
│              AI AGENT LAYER                            │
│  Correlation → Prioritization → Remediation → Reporting│
└────────────────────────────────────────────────────────┘
        ↓
┌────────────────────────────────────────────────────────┐
│              USER INTERFACES                           │
│  Dashboard | Slack | CLI | API | Email alerts         │
└────────────────────────────────────────────────────────┘
```

---

## 4. SCANNING ENGINES: DETAILED SPECS

### **Code Scanning Engine**

**Deployment:**
- CLI tool: `security-scan --code /path/to/repo`
- CI/CD integration: GitHub Actions, GitLab CI, Jenkins, CircleCI plugins
- IDE integration: VS Code, JetBrains extensions (real-time scanning as you code)
- Registry scanning: scan container images in ECR, Docker Hub, GCR, ACR

**What it detects:**
- **Dependencies:** Known vulnerable versions (npm, pip, Maven, Cargo, Go, Composer, NuGet)
- **Secrets:** Hardcoded API keys, tokens, certs, passwords (300+ patterns)
- **SAST:** Injection flaws (SQL, XPath, LDAP), XSS, insecure crypto, hardcoded credentials
- **License:** GPL/LGPL (copyleft) usage violations, restricted licenses
- **SBoM:** Generate software bill of materials (CycloneDX, SPDX formats)
- **Containers:** Alpine/Ubuntu/Debian base image vulnerabilities, supply chain risks
- **IaC:** Terraform/CloudFormation/Kubernetes misconfiguration (open buckets, weak IAM, etc.)

**Output:**
- JSON, SARIF (GitHub-compatible), HTML report
- Auto-creates PRs (with remediation code)
- Sends to central platform via API

**Performance:**
- Scan 1,000-file repo: <30 seconds
- Incremental scanning: only changed files
- Parallelizable: split across CI workers

---

### **Infrastructure Scanning Engine**

**Deployment Model 1: Agent-Based (Recommended)**
```bash
curl https://platform.securitycentral.io/install.sh | bash
# Creates systemd service, runs scans every 6 hours
# Or: integrate with Ansible, Terraform, Kubernetes
```

**What the agent does:**
- Periodically scans:
  - Installed packages (dpkg, rpm, apk, pacman)
  - Running processes + port listeners
  - System configuration (/etc/ssh/sshd_config, /etc/passwd, firewalls)
  - File permissions and SUID binaries
  - Kernel vulnerabilities
- Compares against CVE database (updated daily)
- Reports findings to central platform (encrypted)
- Minimal overhead: <1% CPU, <10MB RAM

**Deployment Model 2: SSH/API-Based (For non-agent infra)**
```
Platform connects via SSH (key-based auth)
├─ Reads: /etc/os-release, dpkg -l, rpm -qa, ps aux, netstat
├─ Analyzes against CVE DB
├─ No persistence on target (stateless)
└─ Reports findings
```

**Cloud Integration:**
- AWS: EC2 instance metadata, Systems Manager inventory
- GCP: GKE node inspection, Cloud Asset Inventory
- Azure: AzureRM API, VM metadata

**What it detects:**
- **OS Vulnerabilities:** Every CVE in packages (prioritized by CVSS + exploitability)
- **Patch Compliance:** Missing security updates, abandoned OS versions
- **Misconfiguration:** Open SSH, weak file permissions, disabled SELinux, etc.
- **CIS Benchmarks:** 
  - CIS Ubuntu 20.04 L1/L2 compliance
  - CIS CentOS 8 compliance
  - CIS Kubernetes benchmark
  - CIS AWS Foundations Benchmark
- **Compliance:** PCI-DSS, SOC 2, HIPAA controls
- **Supply Chain:** Detect suspicious package sources, tampered binaries

---

### **Certificate Monitoring Engine**

**Discovery:**
- Scans all load balancers (ALB, NLB, CloudFront, GCP LB, Azure AppGateway)
- Parses web server configs (nginx, Apache)
- Checks Kubernetes secrets for certificates
- Uses Certificate Transparency logs (public discovery of issued certs for your domains)
- DNS scanning (find all subdomains, check HTTPS adoption)

**Monitoring:**
- Real-time expiration tracking (alert at 90, 60, 30, 14, 7, 1 days)
- Certificate chain validation (are all intermediates present and valid?)
- Algorithm strength checking (no 1024-bit RSA, no SSLv3, TLS 1.0)
- Cipher suite analysis (weak ciphers → warnings)
- Pinning verification (if you use certificate pinning, validate it's correct)

**Remediation:**
- For expiring certificates: auto-suggest renewal process
- Integration with certificate providers (Let's Encrypt API, Digicert, etc.)
- Auto-renewal capability for Let's Encrypt

---

## 5. CORE PLATFORM FEATURES

### **Feature 1: Unified Dashboard**
- **Real-time view** of all vulnerabilities (code + infra + certs)
- **Filter by:**
  - Severity (critical, high, medium, low)
  - Type (CVE, misconfiguration, cert expiry)
  - Service/team/environment
  - Remediation status
- **Drill-down:** Click any finding → see all affected systems, remediation options, history

### **Feature 2: AI-Powered Insights**
- **Risk Correlation:** "This library is in 43 services; 12 can be auto-patched, 31 need review"
- **Reachability Analysis:** "This XSS exists in code, but the vulnerable path is never executed"
- **Business Impact:** "These 5 CVEs could impact payment processing; prioritize"
- **Patch Timing:** "You can batch patch these 8 services together on Friday"

### **Feature 3: Automated Remediation**
- **Code:** Auto-create PRs for dependency updates (with test runs)
- **Infrastructure:** Create tickets for server patching, suggest deployment windows
- **Certificates:** Auto-renew or create renewal reminders
- **Tracking:** Dashboard shows PR → merged → deployed → verified pipeline

### **Feature 4: Compliance Automation**
- **SOC 2:** Generate evidence of vulnerability scanning, remediation, testing
- **PCI-DSS:** Proof of patch management, compliance checks, scans
- **ISO 27001:** Asset inventory, risk assessments, remediation plans
- **HIPAA:** Audit trail of security activities, risk assessments
- **Custom:** Define your own controls, generate evidence

### **Feature 5: Team & Project Management**
- **Assign findings** to teams/owners
- **Set SLAs** (critical: 7 days, high: 30 days, medium: 90 days)
- **Track metrics:** MTTR, SLA compliance, trend analysis
- **Notifications:** Slack, email, PagerDuty, webhooks

### **Feature 6: Integrations**
- **Git:** GitHub, GitLab, Bitbucket (auto-create PRs, push findings to PRs)
- **Ticketing:** Jira, Linear, Azure DevOps (auto-create tickets)
- **Incident:** PagerDuty, Opsgenie (escalate critical findings)
- **Notifications:** Slack, Teams, Discord, email, webhooks
- **Cloud:** AWS, GCP, Azure (read inventory, scan resources)
- **SIEM:** Splunk, Datadog, ELK (export findings for analytics)

---

## 6. REVENUE MODEL

### **Pricing: Consumption-Based + Feature Tiers**

**Tier 1: Starter** — $499/month
- Up to 10 servers/VMs
- Up to 50 repositories
- Code scanning (dependencies only, no SAST)
- Basic infrastructure scanning (agent-based)
- Certificate monitoring (10 domains)
- Email notifications only

**Tier 2: Growth** — $1,999/month
- Up to 100 servers/VMs
- Up to 250 repositories
- Full code scanning (SAST + SCA + container)
- Advanced infrastructure (CIS benchmarks, compliance checking)
- Certificate monitoring (unlimited domains)
- Slack/PagerDuty integration
- AI-powered insights + correlation
- Compliance reporting (SOC 2 template)

**Tier 3: Enterprise** — $5,000-10,000+/month (custom)
- Unlimited servers, repos, domains
- Everything in Growth
- Dedicated account manager
- SSO/SAML
- Custom integrations
- On-premises option
- SLA: 99.9% uptime

**Add-ons:**
- Advanced SAST (language support): +$500/month per language
- Historical data retention (3 years vs. 1 year): +$300/month
- Priority support: +$200/month

### **Financial Model**
- Initial TAM: 5,000 mid-market companies (100-500 engineers each)
- Year 1 target: 50 customers (avg $2K/month) = $1.2M ARR
- Year 2 target: 200 customers = $4.8M ARR
- Year 3 target: 500 customers = $12M+ ARR
- Gross margin target: 75% (scanning engine is SaaS, not hardware-bound)

---

## 7. GO-TO-MARKET STRATEGY

### **Why Customers Buy (vs. Snyk + Tenable)**
| Snyk | Tenable | SecurityCentral | Winner |
|------|---------|-----------------|--------|
| Code scanning | Infrastructure | **Both in one** | **SC** |
| Fast | Comprehensive | **Fast + comprehensive** | **SC** |
| $$$ per project | $$$$ per asset | **Cheaper per asset** | **SC** |
| No infra | No code | **Unified intelligence** | **SC** |
| Manual correlation | Manual correlation | **AI-powered correlation** | **SC** |

### **Ideal Customer Profile**
- 50-500 engineers
- 20+ services/projects
- Using multiple tools (wants consolidation)
- Cares about compliance
- Tired of tool sprawl and alert fatigue
- DevOps + Security teams exist

### **Sales Narrative**
"You're paying for Snyk + Tenable + Dependabot + manual compliance work. We replace that stack with one platform, give you unified risk visibility through AI agents, and reduce your MTTR from 14 days to 3 days."

---

## 8. COMPETITIVE ADVANTAGES

| Competitor | Gap | Our Advantage |
|-----------|-----|--------------|
| Snyk | No infrastructure | We scan code + servers + certs |
| Tenable | No code analysis | We scan servers + code |
| Qualys | Slow agent, expensive | Lightweight agent, cheaper |
| Dependabot | GitHub only | Multi-platform (GitHub/GitLab/Bitbucket) |
| Wazuh | Monitoring focus | Security scanning focus |
| Integrations | Fragmented | Unified with AI correlation |

**Defensibility:**
1. **Proprietary scanning engines** (not API wrappers)
2. **Speed** (agent-based scanning is faster than agentless)
3. **AI correlation** (insights competitors can't provide)
4. **Lower cost** (scanning everything in one platform)
5. **Privacy-first** (scanning happens locally, not cloud)

---

## 9. MVP SCOPE

### **Phase 1: MVP (Months 1-4)**

**Code Scanning Engine:**
- ✅ Dependency scanning (npm, pip, Maven)
- ✅ Secrets detection
- ✅ GitHub + GitLab integration
- ✅ Auto-create PRs for updates

**Infrastructure Scanning:**
- ✅ Agent-based (Linux: Ubuntu, CentOS, Alpine)
- ✅ Package vulnerability detection
- ✅ Basic compliance (CIS Ubuntu L1)
- ✅ AWS EC2 discovery

**Certificate Monitoring:**
- ✅ Auto-discover certs (load balancers, web servers)
- ✅ Expiration tracking + alerts
- ✅ AWS ALB/NLB scanning

**Platform:**
- ✅ Dashboard (vulnerabilities list, drill-down)
- ✅ Slack notifications
- ✅ Basic prioritization (CVSS-based)
- ✅ API for integrations

**NOT in MVP:**
- ❌ SAST (too complex for MVP)
- ❌ Container scanning
- ❌ IaC scanning
- ❌ SSH-based scanning (agent only)
- ❌ GCP/Azure (AWS only)
- ❌ AI agents (launch with basic prioritization)
- ❌ Compliance reporting
- ❌ Team management

### **Phase 2: Intelligence (Months 5-8)**
- AI agents for correlation + prioritization
- Advanced SAST (first language: Python)
- Container scanning
- GCP/Azure support
- Jira/Linear integration

### **Phase 3: Enterprise (Months 9-12)**
- SSH-based scanning
- Full compliance automation (SOC 2, PCI, ISO)
- IaC scanning (Terraform)
- SAML/SSO
- On-premises option

---

## 10. TECHNICAL REQUIREMENTS

### **Code Scanning Engine**
- Language: Go (compiled binary, fast, minimal dependencies)
- Vuln DB: Local copy (updated daily from NVD + proprietary sources)
- SAST: Static analysis (AST-based for each language)
- Container: Read and analyze Docker image layers

### **Infrastructure Scanning Agent**
- Language: Go (binary, <2MB, cross-platform)
- Capabilities: Package enumeration, file permission checks, config parsing
- Communication: HTTPS + mTLS to platform
- Update mechanism: Self-updating (check version, download binary, restart)

### **Certificate Monitor**
- Service: Runs as background process or Kubernetes CronJob
- Discovery: Cloud APIs + port scanning + DNS lookups
- Storage: Certificate data stored encrypted
- Expiration calculation: Always compares wall-clock time vs. cert validity dates

### **Central Platform**
- Backend: Node.js or Python (fast iteration, easy deployment)
- Database: PostgreSQL (audit trail, compliance data)
- Cache: Redis (real-time dashboards)
- Job queue: For async scanning, report generation, integrations
- Search: Elasticsearch (filter millions of findings)
- Real-time: WebSockets or Server-Sent Events (live dashboard updates)

---

## 11. SUCCESS METRICS (12 MONTHS)

| Metric | Target |
|--------|--------|
| Customers onboarded | 50+ |
| ARR | $1.2M+ |
| Customer NPS | >50 |
| Scan coverage | 10,000+ assets |
| MTTR for customers | <5 days (from 14+ days) |
| Compliance audit time | <4 hours (from 40+ hours) |
| False positive rate | <5% |
| Agent adoption | 80%+ of infrastructure customers |

---

## 12. OPEN QUESTIONS FOR VALIDATION

1. **Price sensitivity:** Would mid-market pay $2K/month to consolidate 3-4 tools + get AI correlation?
2. **Agent trust:** How comfortable are customers with running an agent across their infrastructure?
3. **Scanning frequency:** Is hourly scanning for code sufficient, or demand real-time?
4. **SSH vs. Agent:** How many customers have infrastructure that can't run agents (legacy, embedded)?
5. **Differentiation:** Is "AI correlation" enough to justify a new platform, or does it feel like a feature?
6. **Go-to-market:** Should we target security teams first (replace Tenable) or engineering teams first (replace Snyk)?