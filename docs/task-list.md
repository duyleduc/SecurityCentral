# SecurityCentral MVP — Task List

Derived from [mvp-plan.md](./mvp-plan.md) and [ui-wireframes.md](./ui-wireframes.md).

**Phases 1 & 2 can be built in parallel. Phase 2.5 requires both. Phase 3 requires 2.5. Phase 4 is last.**

```
Phase 0 (Foundation)
  ├── Phase 1 (Projects + Domains) ──┐
  │                                   ├── Phase 2.5 (Repos + Code Scanning)
  └── Phase 2 (Servers + Agent) ─────┘         │
                                          Phase 3 (Scoring + Findings)
                                                │
                                          Phase 4 (Real-Time + Polish)
```

---

## Phase 0: Foundation

**Goal:** Docker boots MySQL. API serves `/health`. Dashboard renders login → app shell.

### Infrastructure

- [x] Create `docker-compose.yml` with MySQL 8 service
- [x] Create `Makefile` with `start`, `stop`, `test`, `build` targets

### Backend (platform-api)

- [x] Init Node.js + TypeScript project (`package.json`, `tsconfig.json`)
- [x] Set up Express app with middleware stack (`cors`, `request-id`, `request-logger`, `rate-limit`, `errors`)
- [x] Create Prisma schema for MySQL 8 (Organization, User, ApiKey, Project, Server, MonitoredEndpoint, Scan, Finding, ServerMetricSnapshot, EndpointHeartbeat, InstallToken, Integration, AuditLog, NotificationPreference)
- [ ] Run initial migration
- [x] Create `lib/env.ts` — environment config with validation
- [x] Create `lib/prisma.ts` — Prisma client singleton
- [x] Create `lib/logger.ts` — structured logging
- [x] Create `lib/jwt.ts` — JWT sign/verify helpers
- [x] Create auth module — `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`
- [x] Create auth middleware (JWT Bearer validation)
- [x] Create RBAC middleware (owner / admin / member / viewer)
- [x] Create `GET /health` endpoint
- [x] Create `prisma/seed.ts` with test data

### Frontend (dashboard)

- [x] Init Vite + React 18 + TypeScript project
- [x] Set up MUI v7 theme (`theme/theme.ts`)
- [x] Create API client with interceptors (`api/client.ts`)
- [x] Create `AuthContext` + `ProtectedRoute`
- [x] Create Login page
- [x] Create Register page
- [x] Create AppShell (sidebar nav, top bar with project switcher, search, alerts, user menu)

### Done when

Register → Login → see empty app shell with sidebar.

---

## Phase 1: Projects + Domain Monitoring

**Goal:** Users create projects, add domains, see SSL/uptime/DNS check results.

### Backend

- [x] Projects CRUD — `GET/POST /api/v1/projects`, `GET/PATCH/DELETE /api/v1/projects/:id`
- [x] Project summary — `GET /api/v1/projects/:id/summary`
- [x] Monitoring endpoints CRUD — `GET/POST /api/v1/monitoring/endpoints`, `GET/DELETE /api/v1/monitoring/endpoints/:id`
- [x] Domain check service — SSL/TLS cert fetch, HTTP uptime check, DNS record lookup (SPF/DKIM/DMARC)
- [x] Manual check trigger — `POST /api/v1/monitoring/endpoints/:id/check`
- [x] Check history — `GET /api/v1/monitoring/endpoints/:id/heartbeats`
- [x] In-process scheduler (`scheduler.ts`) — run domain checks per endpoint `checkInterval` (1h/6h/24h)
- [x] Store results in EndpointHeartbeat table

### Frontend

- [x] Projects list page (cards, create dialog)
- [x] Project detail page (linked assets summary)
- [x] Domain list page (chart-first: status summary cards, domain cards with SSL/status chips)
- [x] Add Domain dialog/flow
- [x] Domain detail page (SSL/TLS info, uptime status, DNS security status, check history table)
- [x] React Query hooks for projects and monitoring endpoints

### Done when

Create project → add `google.com` → see SSL cert info, TLS version, SPF/DKIM/DMARC.

---

## Phase 2: Server Monitoring + Go Agent

**Goal:** Go agent on server sends adaptive heartbeats, dashboard shows live metrics.

### Go Agent (sc-agent)

- [x] Init Go module, Cobra CLI setup (`cmd/sc-agent/main.go`)
- [x] Config loading (`internal/config/agentconfig.go`) — API URL, API key, thresholds
- [x] System info collection (`internal/sysinfo/`) — CPU, RAM, disk
- [x] Collect loop (`internal/agent/collector.go`) — every 1s, ring buffer
- [x] Threshold checks (`internal/agent/thresholds.go`) — CPU >85%, RAM >85%, disk >90%
- [x] Send loop (`internal/agent/heartbeat.go`) — urgent 15s debounce, normal 60s
- [x] Platform HTTP client (`internal/platform/client.go`) — register, heartbeat, findings
- [x] Graceful shutdown (`internal/agent/shutdown.go`)
- [x] Structured logging (`internal/logging/logging.go`)
- [x] Cross-compile targets: `linux/amd64`, `linux/arm64`

### Backend

- [x] Install tokens — `GET/POST /api/v1/install-tokens`
- [x] Agent registration — `POST /v1/agents/register` (consume install token, create server record)
- [x] Agent heartbeat — `POST /v1/agents/heartbeat` (store metrics in ServerMetricSnapshot, process alerts)
- [x] Agent findings — `POST /v1/agents/findings`
- [x] Servers read — `GET /api/v1/servers`, `GET /api/v1/servers/:id`
- [x] Server metrics — `GET /api/v1/servers/:id/metrics` (time-series query)

### Frontend

- [x] Server list page (status summary cards, server cards with status/OS/version)
- [x] Add Server dialog (generate install token, show install command with copy button)
- [x] Server detail page (live CPU/RAM/disk cards + Recharts line chart, OS info, server metadata)
- [x] React Query hooks for servers, metrics, and install tokens

### Done when

Install agent → heartbeats arrive → spike CPU → urgent heartbeat within 15s.

---

## Phase 2.5: Repositories + Code Scanning

**Goal:** Connect GitHub/GitLab (cloud + self-hosted), clone repos, scan new code for vulnerabilities and secrets.

### Schema Changes

- [x] Add `Repository` model to Prisma schema (orgId, projectId, provider, providerId, owner, name, defaultBranch, language, cloneUrl, lastScanAt, settings)
- [x] Expand `Integration` model — add `baseUrl`, `verifySsl`, `webhookSecret`, `status` fields
- [x] Add `repositoryId` FK to `Finding` model
- [x] Add `repositoryId` FK to `Scan` model
- [x] Add `repositories` relation to `Organization` and `Project` models
- [ ] Run migration

### Backend — Integrations

- [x] `lib/github.ts` — GitHub App JWT signing, installation token exchange, API client
- [x] `lib/gitlab.ts` — GitLab API client with configurable base URL (cloud + self-hosted), verify SSL toggle
- [x] Integration CRUD — `GET /api/v1/integrations`, `DELETE /api/v1/integrations/:id`
- [x] GitHub App setup — `POST /api/v1/integrations/github` (installationId, appId)
- [x] GitLab setup — `POST /api/v1/integrations/gitlab` (accessToken, baseUrl optional, verifySsl optional)
- [x] GitHub repo listing — `GET /api/v1/integrations/github/repos` (paginated, searchable)
- [x] GitLab repo listing — `GET /api/v1/integrations/gitlab/repos` (paginated, searchable, self-hosted support)
- [x] Repo sync/import — `POST /api/v1/integrations/:provider/repos/sync` (import selected repos into platform)
- [x] GitHub webhook receiver — `POST /api/v1/integrations/github/webhook` (HMAC-SHA256 signature verification, push event handling)
- [x] GitLab webhook receiver — `POST /api/v1/integrations/gitlab/webhook` (X-Gitlab-Token verification, Push Hook handling)
- [x] Env config — `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`

### Backend — Repositories

- [x] Repository CRUD — `GET /api/v1/repositories`, `GET /api/v1/repositories/:id`, `DELETE /api/v1/repositories/:id`
- [x] Manual scan trigger — `POST /api/v1/repositories/:id/scan` (scanType: code_dependencies | code_secrets | code_configs | code_patterns | full)
- [x] Scan history — `GET /api/v1/repositories/:id/scans`

### Backend — Scanner (in-process)

- [x] `lib/clone.ts` — shallow clone with token-in-URL auth (`git clone --depth 1`), temp dir management, cleanup after scan
- [x] Clone URL builder — GitHub: `x-access-token:{token}@`, GitLab: `oauth2:{token}@{host}/`
- [x] Scan orchestrator (`modules/scanner/`) — clone repo, determine changed files (delta mode), run sc-scan binary, ingest results
- [x] Delta mode — `git diff --name-only origin/{defaultBranch}...HEAD` to scope changed files for feature branch scans
- [x] Finding ingestion — dedup by (cveId + repositoryId) or (title + repositoryId), auto-resolve stale findings not in new scan
- [x] Webhook → scan trigger — push to default branch = full scan, push to feature branch = delta scan (changed files only)

### Go Scanner (sc-scan) — port from archived

- [x] Init Go module (`sc-scan/go.mod`), Cobra CLI setup (`cmd/sc-scan/main.go`)
- [x] CLI flags: `--repo-dir <path>`, `--changed-files <comma-list>` (delta mode), `--scan-type <type>`, `--output json`
- [x] Dependency scanner (`internal/scanner/deps/`) — parse lockfiles: `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `requirements.txt`, `Pipfile.lock`, `poetry.lock`, `pom.xml`, `gradle.lockfile`
- [x] CVE matching (`internal/vulndb/`) — lookup ecosystem + package name against vulnerability database
- [x] Secrets scanner (`internal/scanner/secrets/`) — 50+ regex patterns (AWS keys, GCP creds, GitHub tokens, private keys, DB URIs, generic secrets) + Shannon entropy filtering (>4.5)
- [x] Unsafe config scanner (`internal/scanner/configs/`) — debug flags, insecure CORS, permissive headers
- [x] Risky pattern scanner (`internal/scanner/patterns/`) — `eval`, insecure crypto, SQL concatenation
- [x] `.securitycentral.yml` config support (`internal/config/`) — ignore rules (CVE, package, severity), secret allow-lists (path, pattern, hash)
- [x] JSON output format for platform ingestion
- [x] Cross-compile targets: `linux/amd64`, `linux/arm64`, `darwin/amd64`, `darwin/arm64`

### Frontend

- [x] Integrations section in Settings page — list connected providers with status
- [x] Connect GitHub dialog — installation ID input, link to GitHub App install page
- [x] Connect GitLab dialog — access token input, self-hosted toggle (base URL + verify SSL fields)
- [x] Repository import picker — list repos from provider, checkbox select, import button
- [x] Repository list page (cards with language badge, last scan date, score, provider icon)
- [x] Repository detail page (scan history table, findings breakdown by severity, trigger scan button)
- [x] React Query hooks for integrations, repositories, and scans

### Done when

Connect GitHub → import repo → push to new branch → scan runs on changed files only → findings appear with severity and fix recommendations.

---

## Phase 3: Scoring + Findings + Dashboard

**Goal:** Security scores (0–100) per asset, findings list, dashboard overview.

### Backend

- [x] Scoring engine (`lib/scoring.ts`) — calculate score per asset (repository, server, domain) with severity-based deductions, return breakdown
- [x] Findings CRUD — `GET /api/v1/findings`, `GET /api/v1/findings/:id`, `PATCH /api/v1/findings/:id` (status transitions)
- [x] Auto-create findings from domain checks (SSL issues, DNS gaps, downtime)
- [x] Auto-create findings from agent alerts (CPU/RAM/disk threshold breaches)
- [x] Auto-create findings from code scans (dependency CVEs, exposed secrets, unsafe configs, risky patterns) — handled by Phase 2.5 scanner ingestion
- [x] Dashboard summary — `GET /api/v1/dashboard/summary` (include repository counts and scores)
- [x] Dashboard top risks — `GET /api/v1/dashboard/top-risks` (include code scan findings)
- [x] Dashboard assets — `GET /api/v1/dashboard/assets` (include repositories)

### Frontend

- [x] `ScoreBadge` component (color-coded 0–100 with breakdown tooltip)
- [x] Dashboard overview page (severity cards, trends line chart, recent alerts, score cards per asset type including repos)
- [x] Findings list page (filterable by severity, source, status; drill-down to detail; source filter includes `code_scanner`)
- [x] Add scores to server detail, domain detail, and repository detail pages

### Done when

Repositories, domains, and servers show scores with "why" breakdown. Dashboard shows top risks across all asset types.

---

## Phase 4: Real-Time + Polish

**Goal:** WebSocket updates, notifications, onboarding, deployment.

### Backend

- [x] Socket.IO server setup (`ws/server.ts`) — JWT handshake, org-scoped rooms
- [x] WebSocket event hooks (`ws/hooks.ts`) — emit `finding:new`, `finding:resolved`, `scan:completed`, `agent:connected`, `agent:disconnected`, `cert:expiring`, `audit:new`, `server:metrics`, `endpoint:status-change`
- [x] Offline detection — `setInterval` every 5 min, flag agents that missed heartbeats, emit `agent:disconnected`
- [x] Org settings module (`modules/organizations/`) — org CRUD, member management, role updates
- [x] Notification preferences module (`modules/notifications/`) — CRUD per channel + event type
- [x] API keys management module (`modules/apikeys/`) — create (raw key shown once), list, revoke
- [x] Audit log module (`modules/audit/`) — create entries, list with filters

### Frontend

- [x] WebSocket client (`ws/client.ts`) — connect, reconnect, handle events
- [x] Real-time React Query invalidation on WebSocket events (`ws/useRealtimeEvents.ts` — mounted in AppShell)
- [x] Settings page — 4 tabs: Organization (name, plan, team members), Integrations (GitHub/GitLab), API Keys (create/revoke), Notifications (event x channel toggle matrix)
- [x] Onboarding wizard (`pages/Onboarding/`) — 3-step stepper: create project → add domain → install agent

### Deployment

- [x] Dockerfile for platform-api (multi-stage: build + production alpine)
- [x] Dockerfile for dashboard (multi-stage: build + nginx with SPA fallback + API proxy)
- [x] Go cross-compile in Makefile (`linux/amd64` + `linux/arm64`)
- [x] Update `docker-compose.yml` to boot entire stack (mysql + platform-api + dashboard)

### Done when

Dashboard updates in real-time. `docker compose up` boots entire stack.

---

## Phase 2A: Agent Core Metrics Extension

**Goal:** Extend sc-agent from 3 metrics (CPU/RAM/Disk%) to competitive parity with essential monitoring data. No architectural change — add fields to existing structs.

**Ref:** [sc-agent-architecture.md](./sc-agent-architecture.md) §15, [spec-analysis-report.md](./spec-analysis-report.md)

### Go Agent (sc-agent)

- [x] Add load average (1/5/15) to `sysinfo.CollectMetrics()` via `gopsutil load.Avg()`
- [x] Add CPU iowait % to `sysinfo.Metrics` via `gopsutil cpu.Times()` delta calculation
- [x] Add swap used % to `sysinfo.Metrics` via `gopsutil mem.SwapMemory()`
- [x] Add disk I/O (read/write bytes/s, utilization %) via `gopsutil disk.IOCounters()` with delta between samples
- [x] Add network RX/TX bytes and errors per interface via `gopsutil net.IOCounters()` with delta between samples
- [x] Extend `sysinfo.Metrics` struct with all new fields
- [x] Extend `platform.MetricsData` to `MetricsDataV2` with `Load`, `Disk.IO`, `Network`, `Memory.SwapUsedPct`
- [x] Update `RingBuffer.Aggregate()` to include iowait avg/max
- [x] Add iowait threshold to `ThresholdConfig` (default 20%) and `config.Config`
- [x] Add spike detection to `CheckThresholds()` — alert if CPU or RAM jumps >40% between samples
- [x] Store previous disk I/O and network counters for delta calculation (init on first sample)

### Backend (platform-api)

- [x] Update `POST /v1/agents/heartbeat` handler to accept `MetricsDataV2` payload (backward-compatible with v1)
- [x] Extend `ServerMetricSnapshot` Prisma model with new fields (loadAvg1, loadAvg5, loadAvg15, cpuIoWait, swapUsedPct, diskReadBps, diskWriteBps, diskIoUtil, netRxBytes, netTxBytes, netErrors)
- [x] Update server metrics query `GET /api/v1/servers/:id/metrics` to return new fields

### Frontend (dashboard)

- [x] Add load average display to server detail page
- [x] Add disk I/O chart (read/write bytes/s) to server detail page
- [x] Add network throughput chart (RX/TX) to server detail page
- [x] Add swap usage indicator to server detail page

### Done when

Agent sends load avg, iowait, swap, disk I/O, and network metrics. Server detail page shows all new charts.

---

## Phase 2B: Agent Collector Architecture

**Goal:** Refactor sc-agent into pluggable collector system with multi-cadence scheduling. Foundation for all future collectors.

**Ref:** [sc-agent-architecture.md](./sc-agent-architecture.md) §3–§6, §11

### Go Agent (sc-agent)

- [x] Create `Collector` interface in `internal/collector/collector.go` — `Name()`, `Cadence()`, `Enabled()`, `Init()`, `Collect()`
- [x] Create `Registry` with `Register()`, `Enabled()`, `ByCadence()` methods
- [x] Create `Scheduler` in `internal/agent/scheduler.go` — goroutine per cadence group, results channel
- [x] Create `MetricStore` in `internal/agent/store.go` — holds latest snapshots + ring buffers for fast-cadence metrics
- [x] Extract CPU collector (`internal/collector/cpu.go`) — CadenceFast, returns CPU%, iowait%, load avg
- [x] Extract Memory collector (`internal/collector/memory.go`) — CadenceFast, returns used%, swap
- [x] Extract Disk collector (`internal/collector/disk.go`) — CadenceStandard, returns usage + I/O deltas
- [x] Extract Network collector (`internal/collector/network.go`) — CadenceStandard, returns per-interface bytes/errors + TCP count
- [x] Split `agent/collector.go` into `agent/alertbuffer.go` + `agent/store.go` (ring buffer moved into store)
- [x] Refactor `agent/heartbeat.go` — use Scheduler + MetricStore + processLoop instead of raw collectLoop
- [x] Verify existing heartbeat timing (60s normal, 15s urgent) is preserved after refactor
- [x] Run `go test -race ./...` — 12 tests pass with no race conditions

### Done when

Agent boots with registry of 4 collectors (CPU, Memory, Disk, Network), scheduler ticks at correct cadences, heartbeat payload unchanged.

---

## Phase 3A: Agent Security-Relevant Collectors

**Goal:** Add process, service, and security monitoring to sc-agent. Enables alert rules #8–#11 from product spec.

**Ref:** [sc-agent-architecture.md](./sc-agent-architecture.md) §4.5–§4.8, §8

### Go Agent (sc-agent)

- [x] Create Process collector (`internal/collector/process.go`) — CadenceStandard: total count, zombie count, top 5 CPU/RAM consumers, OOM kill events
- [x] Create Service collector (`internal/collector/service.go`) — CadenceStandard: failed systemd units (exec `systemctl --failed`)
- [x] Create Security collector (`internal/collector/security.go`) — CadenceScan: listening ports, SSH config, firewall status, logged-in users, SSH auth failures, shell users, pending reboot, open FDs
- [ ] Add daily collection to Security collector: installed packages (dpkg/rpm), world-writable files in /etc /usr
- [x] Extend `ThresholdChecker` with new port baseline detection — alert on new externally-bound port (#8 New Public Port)
- [ ] Extend `ThresholdChecker` with suspicious process detection — unknown process >50% CPU for 3 min (#9)
- [x] Extend `ThresholdChecker` with service failure detection — any failed systemd unit (#11)
- [x] Add `ProcessMetrics` and `ServiceMetrics` to heartbeat `MetricsDataV2`
- [x] Register Process, Service, Security collectors in agent startup

### Backend (platform-api)

- [x] Create `POST /v1/agents/security-posture` endpoint — accept and store security scan results
- [x] Create `SecurityPosture` Prisma model (listeningPorts, sshConfig, firewallActive, firewallType, shellUsers, pendingReboot, sshFailures, loggedInUsers)
- [ ] Update server scoring to incorporate security posture data (SSH config, firewall, open ports, user access, file permissions)
- [x] Add new alert types to findings auto-creation: `port_new`, `service_down`, `ssh_brute_force`
- [x] `GET /api/v1/servers/:id/security-posture` — return latest security posture report

### Frontend (dashboard)

- [x] Add security posture tab to server detail page (SSH config status, firewall status, open ports list, shell users, pending reboot)
- [x] Add process monitor section to server detail page (process/service data in heartbeat payload)
- [x] Add service health section to server detail page (failed units in heartbeat)
- [ ] Update server score badge to reflect security posture findings

### Done when

Agent reports listening ports, SSH config safety, firewall status, and top processes. Server detail page shows security posture tab with scores.

---

## Phase 3B: Agent Docker Collector (Optional)

**Goal:** Monitor Docker containers on servers where Docker is present.

**Ref:** [sc-agent-architecture.md](./sc-agent-architecture.md) §4.7

### Go Agent (sc-agent)

- [x] Create Docker collector (`internal/collector/docker.go`) — CadenceStandard, conditional on Docker presence
- [x] Feature detection: check `docker` binary + `docker info` to verify daemon is running
- [x] Collect: running/stopped count, per-container ID/name/image/state/CPU/memory/restarts
- [x] Use exec `docker ps -a --format json` + `docker stats --no-stream --format json` + `docker inspect` (no Docker SDK)
- [x] Add `DockerMetrics` (optional/nil) to heartbeat payload

### Backend (platform-api)

- [x] Store Docker metrics as JSON column in `ServerMetricSnapshot`
- [x] Auto-create finding for crash-looping container (restarts > 0, severity high if >= 5)
- [x] Add Docker data to heartbeat validation schema

### Frontend (dashboard)

- [x] Add Docker tab to server detail page (container table with name, image, state, CPU%, memory%, restarts)

### Done when

On a Docker host, agent reports container status. Dashboard shows container health.

---

## Phase 5A: Package Inventory + Server-Side CVE Matching

**Goal:** Collect OS package list from agents, match against NVD/distro CVE databases server-side, create findings for vulnerable packages. This is the #1 gap in the product spec (4.2.1: "OS version & patch status").

**Ref:** [server-cve-scanning-analysis.md](./server-cve-scanning-analysis.md)

**Scope boundary:** OS packages + system binaries only. Language ecosystem CVEs (npm, pip, maven, go) are handled by sc-scan (repo scanning).

### Go Agent (sc-agent)

- [x] Add `PackageInventory` collector (`internal/collector/packages.go`) — CadenceDaily: collects OS package list, system binary versions, pending security updates
- [x] Collect full package list via `dpkg-query` (Debian/Ubuntu) or `rpm -qa` (RHEL/CentOS)
- [x] Detect package manager type from `/etc/os-release` (apt vs yum/dnf)
- [x] Collect pending security updates count (`apt list --upgradable` filtered for security)
- [x] Collect held/pinned packages (`apt-mark showhold`)
- [x] Collect running kernel vs latest installed kernel (`uname -r` vs `dpkg -l linux-image-*`)
- [x] Collect unattended-upgrades status (`systemctl is-active unattended-upgrades`)
- [x] Collect system binary versions (auto-detect): OpenSSL, OpenSSH, glibc, curl, nginx, Docker, containerd, runc
- [x] Hash package list (SHA256) — only triggers CVE re-matching if changed
- [x] Add to platform client: `POST /v1/agents/package-inventory` with `PackageInventoryRequest` struct
- [x] Register PackageInventory collector in agent startup

### Backend (platform-api) — Vulnerability Database Module

- [x] Create `modules/vulndb/` module with vulndb.service.ts
- [x] Implement Debian Security Tracker JSON feed downloader — daily sync via scheduler
- [ ] Implement Ubuntu CVE Tracker feed downloader (`https://ubuntu.com/security/cves.json`)
- [x] Implement CISA KEV JSON feed downloader — daily sync
- [x] Create `VulnerabilityFeed` Prisma model (source, lastSyncAt, data JSON) for caching feeds
- [x] Create `PackageInventory` Prisma model (serverId, packages JSON, binaryVersions, hash, metadata)
- [x] Implement `matchServerPackages(serverId, osFamily, packages[])` — match against Debian security tracker, cross-reference CISA KEV
- [x] Create `Finding` records with `source: 'cve_scan'`, `cveId`, `detail: {packageName, installedVersion, fixedVersion, cisaKev}`
- [x] Auto-resolve stale CVE findings when a package is updated (new inventory shows patched version)
- [x] Add feed sync to `scheduler.ts` — daily vuln DB refresh + initial sync on startup
- [x] `POST /v1/agents/package-inventory` endpoint — accept package list from agent, store + trigger CVE matching
- [x] `GET /api/v1/servers/:id/vulnerabilities` endpoint — return CVE findings for a server
- [x] `GET /api/v1/servers/:id/packages` endpoint — return latest package inventory

### Backend — Validation & Types

- [x] Create `PackageInventorySchema` (Zod) — agentId, osFamily, packages, binaryVersions, pendingSecurityUpdates, heldPackages, kernelRunning, kernelInstalled, unattendedUpgrades, packageHash

### Backend — Scoring Integration

- [ ] Update scoring engine to incorporate CVE findings: Critical CVE = -20, High = -10, Medium = -5, Low = -2 (capped at -60 from CVEs)
- [ ] CISA KEV CVE = always -20 deduction regardless of CVSS
- [ ] Fix available but not applied = extra -5 deduction

### Frontend (dashboard)

- [x] Add "Vulnerabilities" tab to server detail page (3rd tab, shows count in tab label)
- [x] CVE findings table: CVE ID (clickable link to NVD), package name, installed version, fixed version, severity chip, CISA KEV badge
- [x] Filter chips: total, critical, high, fix available, CISA KEV
- [x] Summary header chips: total CVEs, critical count (red), high count (orange), fix-available count, KEV count
- [x] Empty state: "No vulnerabilities found" with daily scan explanation
- [x] Add `useServerVulnerabilities(id)` hook — `GET /api/v1/servers/:id/vulnerabilities`, refetch 60s
- [x] Add `usePackageInventory(id)` hook — `GET /api/v1/servers/:id/packages`
- [ ] Package inventory view: collapsible section showing full package list with version, searchable
- [ ] Add CVE count badge to server list cards (e.g., "3 critical CVEs" chip in red)
- [ ] Add CVE summary to dashboard top-risks widget (across all servers)

### Done when

Agent sends daily package list → platform matches against Debian/Ubuntu security tracker + CISA KEV → CVE findings appear on server detail "Vulnerabilities" tab → user can filter by severity and see fix-available packages.

---

## Phase 5B: Extended Security Audit

**Goal:** Add remaining server hardening checks from the CVE scanning spec — user audit, filesystem audit, kernel hardening, container runtime security. These produce config-level findings (not CVE findings).

**Ref:** [server-cve-scanning-analysis.md](./server-cve-scanning-analysis.md) — Tier 1 built-in checks #16–35

### Go Agent (sc-agent)

- [x] Create `AuditCollector` (`internal/collector/audit.go`) — CadenceDaily, runs 25 hardening checks
- [x] User audit: UID 0 accounts (non-root), users with empty password, password hash algorithm (MD5=critical), NOPASSWD sudoers rules, home directory permissions >750
- [x] Kernel hardening: ASLR, kptr_restrict, dmesg_restrict, core dump restriction, ptrace_scope, CPU vulnerability mitigations from `/sys/devices/system/cpu/vulnerabilities/*`
- [x] Filesystem audit: SUID binaries count, world-writable files in /etc, executables in /tmp and /var/tmp, /etc/passwd and /etc/shadow permissions + ownership
- [x] Container runtime: Docker socket permissions, privileged containers, containers mounting docker.sock
- [x] Add `auditResults []AuditResultEntry` to `SecurityPostureRequest` — each with id, category, title, status (pass/fail/warn), severity, detail
- [x] Audit results sent alongside security posture (included in the hourly posture POST)

### Backend (platform-api)

- [x] Create `AuditResult` Zod schema and add to SecurityPosture validation
- [x] Store audit results in SecurityPosture model (added `auditResults Json?` column)
- [x] Auto-create findings from failed audit checks with `source: 'security_audit'`, dedup by title
- [x] Auto-resolve audit findings when checks start passing
- [x] `GET /api/v1/servers/:id/security-posture` returns audit results in response
- [ ] Update scoring: each failed critical audit check = -15, high = -8, medium = -3

### Frontend (dashboard)

- [x] Extend Security Posture tab with "Hardening Audit" card
- [x] Audit results grouped by category (Kernel, Users, Filesystem, Container) with colored left border
- [x] Each check shows pass/fail/warn icon, title, severity chip (on fail), and detail text
- [x] Summary: "N/M passed" chip with progress bar (green if all pass, warning/red otherwise)
- [x] Failed checks show severity badge and remediation detail

### Done when

Security posture tab shows hardening audit results grouped by category. Failed checks auto-create findings. Server score reflects audit failures.

---

## Phase 5C: SSH Deep Config + Service Hardening

**Goal:** Deep SSH configuration audit (ciphers, MACs, KEX, host key algorithms) and infrastructure service hardening checks (Redis auth, DB bind address, NFS exports, legacy protocols).

**Ref:** [server-cve-scanning.md](./server-cve-scanning.md) — Sections 5 (SSH) and 10 (Services)

### Go Agent (sc-agent)

- [ ] SSH deep config via `sshd -T`: ciphers (no arcfour, 3des-cbc), MACs (no hmac-md5, hmac-sha1), KEX algorithms (no diffie-hellman-group1-sha1), host key algorithms (no ssh-dss), MaxAuthTries <=4, X11Forwarding, AllowTcpForwarding, ClientAliveInterval
- [ ] Redis hardening (if running): `requirepass` set, bind to 127.0.0.1 only
- [ ] MySQL/MariaDB bind address (if running): check for 127.0.0.1
- [ ] PostgreSQL pg_hba.conf (if running): no `trust` auth for network clients
- [ ] NFS exports: check for `no_root_squash`
- [ ] Legacy protocol detection: Telnet (:23), FTP (:21), rpcbind (:111) running
- [ ] SNMP default community strings (`public`/`private`)

### Backend (platform-api)

- [ ] Extend audit result types for SSH deep config and service checks
- [ ] Auto-create findings: "SSH allows weak cipher 3des-cbc", "Redis has no authentication", "Telnet service running on port 23"

### Frontend (dashboard)

- [ ] Extend Security Posture SSH section with full config details (ciphers, MACs, KEX — green/red per item)
- [ ] Add "Service Hardening" section: per-service checks with pass/fail status
- [ ] Legacy protocol warnings prominently displayed

### Done when

SSH section shows full cipher/MAC/KEX audit with pass/fail per algorithm. Service hardening section shows Redis/DB/NFS/legacy protocol checks.
