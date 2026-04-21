# SecurityCentral — Product Documentation

> **Version:** MVP build as of 2026-04-21
> **Audience:** product team, new engineers, prospective customers, support
> **Status:** Pre-GA. Core flows work end-to-end; a handful of features are stubbed (scanner binary, repo-scan triggering).

---

## 1. Executive Summary

**SecurityCentral** is a lightweight infrastructure security and monitoring platform for **small and medium enterprises** (SMEs) that don't have a dedicated security team. It gives an engineering lead, IT manager, or founder one place to answer three questions:

1. **Are my servers okay?** — CPU/RAM/disk, OS patch level, firewall, SSH hardening, failed logins, running Docker, suspicious processes, exposed ports.
2. **Are my public-facing services okay?** — SSL certificate validity and grade, uptime, TLS version, response time.
3. **Is my code safe to deploy?** — dependency CVEs, secrets, unsafe configurations across GitHub/GitLab repositories.

The product is opinionated and non-security-team-friendly: every risk comes with **severity + explanation + remediation**, scored on an A–F grade scale, with sensible defaults that work out of the box.

### What makes it different

| Typical alternative | SecurityCentral |
|---|---|
| Datadog / New Relic — monitoring only, no security | Monitoring + security on the same asset |
| Nessus / Qualys — heavy enterprise agents, complex | Single-binary Go agent, installed via one-line curl |
| GitHub Dependabot — repos only | Repos + servers + domains unified |
| Pingdom / UptimeRobot — uptime only | Uptime + SSL grade + DNS hygiene |
| Spec-heavy SIEMs | No dashboards to build; opinionated defaults |

Our north star: a **non-security-specialist** can plug in a server, add a domain, connect GitHub, and within 5 minutes have an actionable security summary with concrete fixes.

---

## 2. Target Customer & Problem

### Who we serve

- Companies with **1–50 engineers** running ~5–50 production servers.
- Teams that host their own infra (VPS, GCE, EC2, Hetzner, OVH, bare metal) rather than full PaaS.
- Tech-adjacent founders and IT leads without a CISO.
- Compliance-adjacent scenarios (SOC 2 Type I prep, ISO 27001 evidence gathering, customer security questionnaires).

### Pain points we solve

1. **"I don't know what's running on my servers."** Teams lose track of Docker containers, open ports, package versions. Our agent reports them continuously.
2. **"I'm told my cert is about to expire by my customers."** We monitor SSL certs and warn 30/14/7 days before expiry — plus catch weak TLS configs.
3. **"My lead developer left and the GitHub access is a mess."** We show which repos we're watching, per-project, with findings grouped by severity.
4. **"A customer asked for a security report and I have nothing."** The per-server and per-domain full reports export a dated PDF/print summary.
5. **"I get paged at 3am for a failed deploy but never for a brute-force attack."** We surface brute-force SSH activity, compromised logins, and exposed admin panels in a way that stands out from noise.

### Out-of-scope (for now)

- Full SIEM / log aggregation.
- Incident response runbooks.
- Anti-malware / EDR on the host.
- Managed pentesting, bug bounty triage.
- Container image registry scanning (runtime Docker is monitored; registry/Dockerfile scanning is on the roadmap).

---

## 3. Product at a Glance

```
┌──────────────────────────────────────────────────────────────────────┐
│                         SecurityCentral                              │
│                                                                      │
│   Organization                                                       │
│     └── Projects (logical grouping)                                  │
│            ├── Servers    (agent-reported)                           │
│            ├── Domains    (externally probed)                        │
│            └── Repos      (scanned from GitHub/GitLab)               │
│                                                                      │
│   Unified findings → A–F security score per asset + aggregated       │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Core asset types

Every asset (server, domain, repo) is:

- Grouped under a **Project** (e.g., `prod`, `staging`, `customer-app-X`) for multi-tenant scoping inside one organization.
- Tagged with arbitrary `key[=value]` labels (e.g., `env=prod`, `tier=web`, `owner=payments-team`).
- Scored **0–100** with a letter grade (**A / B / C / D / F**) computed from the open findings weighted by severity.
- Searchable and filterable by **project**, **tag**, and **status** on every list view.

### User roles

Only **two effective roles** (plus a legacy `owner` for backwards compat that acts as admin but cannot be removed):

| Role | Can do | Cannot |
|---|---|---|
| **admin** | Everything: invite users, connect integrations, add/remove servers and domains, change settings, trigger scans, resolve findings | — |
| **member** | Read-only: view dashboards, servers, domains, findings, reports | Any mutation (create/update/delete) |

Permissions are enforced server-side via a typed `requirePermission()` middleware; the dashboard additionally hides admin-only controls.

---

## 4. Component Architecture

SecurityCentral is a small monorepo of five deployable components, all in the same Git repository.

```
┌──────────────┐        ┌───────────────────┐        ┌──────────────┐
│   Dashboard  │◀──────▶│   Platform API    │◀──────▶│  PostgreSQL  │
│  (React SPA) │  HTTPS │ (Node.js/Express) │  SQL   │   (Supabase) │
└──────────────┘        └──────▲─────▲──────┘        └──────────────┘
                               │     │
                   Agent       │     │       Code scan (in-process)
                   X-API-Key   │     │       ┌──────────────┐
                               │     └──────▶│   sc-scan    │
                               │             │  (Go binary) │
                               │             └──────────────┘
                      X-API-Key│
                               │
                        ┌──────┴──────┐      ┌──────────────┐
                        │  sc-agent   │      │  sc-monitor  │
                        │ (Go binary) │      │ (Go binary)  │
                        │ on customer │      │ on our infra │
                        │   servers   │      │  polls public│
                        │             │      │   endpoints  │
                        └─────────────┘      └──────────────┘
```

### 4.1 `platform-api` — Node.js + TypeScript + Express

The single source of truth. ~18 Express modules under `src/modules/`:

| Module | Responsibility |
|---|---|
| `auth` | register, login, refresh (JWT access + refresh cookies) |
| `organizations` | org settings, member list, role change, remove member |
| `invitations` | admin-facing create/list/revoke/resend + public accept |
| `projects` | logical asset groupings |
| `servers` | server CRUD, metrics queries, full report |
| `monitoring` | domain/endpoint CRUD, heartbeat history, SSL scan trigger |
| `agents` | install tokens, agent registration/heartbeat/findings/posture intake |
| `attack-surface` | external port scanner + service fingerprinting |
| `integrations` | GitHub/GitLab connection, repo listing, webhook ingest |
| `repositories` | imported repos, per-repo scans, findings |
| `scanner` | orchestrates code scans via the `sc-scan` binary |
| `vulndb` | CVE feed sync (OSV.dev, CISA KEV, EPSS) |
| `findings` | unified cross-asset finding list with filters |
| `dashboard` | org-wide summary + top-risks aggregations |
| `audit` | append-only audit log |
| `notifications` | per-org notification preferences |
| `apikeys` | long-lived API keys for programmatic access |
| `monitor` | endpoints exposed to `sc-monitor` |

**Key conventions**

- Every module has `*.router.ts`, `*.service.ts`, `*.validation.ts` (Zod schemas).
- All requests validated with Zod before reaching the service layer.
- All responses wrapped in `{ data, meta, errors }` envelope via `successEnvelope()` / `errorEnvelope()`.
- Typed errors via `AppError` with stable error codes (`AUTH_INVALID_CREDENTIALS`, `RESOURCE_NOT_FOUND`, `VALIDATION_ERROR`, `CONFLICT`).
- Two auth strategies: **JWT** (dashboard users) and **X-API-Key** (agents, monitor, external integrations).
- In-process scheduler (`src/scheduler.ts`) runs domain checks and offline-detection sweeps — no external job queue for MVP.
- Outbound email via generic SMTP (`src/lib/mailer.ts`) — provider-agnostic (Resend, Postmark, Gmail, SES).

### 4.2 `dashboard` — React 18 + TypeScript + Vite + MUI v7

Single-page app with React Query v5 for data fetching, Recharts for graphs, React Router v7 for navigation.

**Major pages**

| Route | Page | Purpose |
|---|---|---|
| `/` | Dashboard overview | Org-wide score, asset counts, top risks |
| `/projects`, `/projects/:id` | Projects | Groupings + per-project asset list |
| `/servers` | Servers list | Cards with status filter, tag filter, project filter |
| `/servers/:id/monitoring` | Server — Monitoring | CPU/RAM/disk/load/IO/network charts + gauges + Docker |
| `/servers/:id/security` | Server — Security | Posture, vulnerabilities, attack surface |
| `/servers/:id/report` | Server — Full Report | Printable one-page PDF-style summary |
| `/domains`, `/domains/:id` | Domains | Uptime, SSL, DNS per endpoint |
| `/repositories`, `/repositories/:id` | Repos | Imported repos + scan history |
| `/findings`, `/findings/:id` | Findings | Unified cross-asset list |
| `/settings` | Settings | Org, members, invitations, integrations, API keys, notifications |
| `/integrations/:provider/repos` | Repo selection | Paginated list from provider to import |
| `/invite/:token` | Accept invite | Public page — invitee sets password, becomes a member |

**Real-time**: uses a WebSocket channel (`ws/`) to receive heartbeats and push live updates on the server detail page without polling.

### 4.3 `sc-agent` — Go binary on the customer's server

Single static binary (~20 MB). Deployed via a one-line install command that registers the agent to an install token.

**Capabilities**

- **Metrics**: CPU (user / iowait), RAM, swap, load avg 1/5/15, disk usage + I/O util + read/write bps, network rx/tx bytes per interface, Docker container stats.
- **Adaptive heartbeat**: collect every 1s, send every **60s** (normal) or **15s** (urgent with debounce) when a threshold breach occurs (CPU >85%, RAM >85%, disk >90%).
- **Security posture** (hourly scan):
  - Listening ports cross-referenced with firewall rules → each port tagged `internet | restricted | blocked | localhost`.
  - Firewall type detection (`ufw`, `nftables`, `iptables` + `fail2ban`) and misconfiguration hints (default ACCEPT policy, unused rules).
  - SSH config (root login, password auth, empty password, port) + failed login count.
  - Pending reboot detection.
  - Brute-force signals: SSH velocity, distinct attacker IPs, HTTP 401/403 velocity, compromise detection (attacker succeeds after N failures).
- **Package inventory** (daily): dpkg / rpm / apk lists + binary versions (docker, node, openssl, nginx, …) with a content hash for change detection.
- **Suspicious process** watcher: known-miner binaries, sustained high-CPU outliers, reverse-shell signatures, processes from unusual paths.
- **Hardening audit**: runs a CIS-benchmark-inspired checklist server-side after each posture submission.
- **Self-update**: pulls its own new binaries from `/v1/agents/download`; systemd handles restart.

Communication is outbound-only, over HTTPS, authenticated with a per-agent `X-API-Key` issued at registration.

### 4.4 `sc-monitor` — Go binary on *our* infrastructure

Polls customer domains from the outside: TCP reachability, HTTP status, TLS handshake (version + grade), response time. Runs as a single instance on a tiny GCE free-tier VM. Authenticates to `platform-api` with a shared API key.

### 4.5 `sc-scan` — Go binary invoked in-process by `platform-api`

Code scanner for:

- **Dependency SCA** (npm, pip, Gemfile, Go modules, Maven, Cargo) cross-referenced with OSV.dev.
- **Secrets** (regex + entropy): AWS keys, private keys, GitHub tokens, Slack tokens, etc.
- **Unsafe configs**: `.env` in tracked files, permissive CORS, debug flags, weak crypto.
- **Risky patterns**: SQL concatenation, `eval()`, unescaped shell exec.

Runs **full scan** on default-branch pushes, **delta scan** on feature-branch pushes.

> **Status note:** the scanner binary itself is scaffolded but not yet invoked by the API in production code paths.

### 4.6 Infrastructure

- **PostgreSQL 16** (Supabase cloud in prod; local Docker in dev). Prisma ORM. JSONB-heavy schema for flexible data (tags, metric alerts, agent findings).
- **GCP Cloud Run** for `platform-api` (scale-to-zero).
- **Google Cloud Storage** bucket for `dashboard` static assets.
- **GCE e2-micro** for `sc-monitor` (free tier).
- **GitHub Actions** CI/CD with path-filtered conditional deploys.

---

## 5. Feature Catalog

### 5.1 Organization & Access

#### Sign-up

A first-time user registers an organization and becomes its **owner**. Registration creates both the `Organization` and the initial `User` in one transaction.

#### Team members — invitation flow

Admins invite new members via **email**:

1. Admin opens Settings → Team Members → **Invite Member**.
2. Enters the invitee's **name**, **email**, and **role** (member | admin). **No password is set** by the admin.
3. Backend creates an `Invitation` record (random 32-byte token, stored only as SHA-256 hash), default **7-day expiry**.
4. Backend attempts to email the invitation link. If SMTP is configured → the invitee gets an email with a one-click accept button. If not → admin sees the link in the dialog and shares it manually. The link is **shown only once**.
5. Invitee opens `/invite/:token`, sees org name + their assigned role + expiry, chooses their own password (min 8 chars + confirm), and is signed in immediately on submit.

#### Invitation management

- **Pending invitations** table shows status (Active / Expired), expiry time, role, email.
- Admins can **resend** — issues a fresh token (invalidating the old one), resets expiry, re-sends the email.
- Admins can **revoke** — deletes the pending invitation.
- Accepted invitations are hidden (the user appears in the Members table instead).

#### Role management & removal

- Role displayed as an inline dropdown for rows the current admin is allowed to modify.
- **Guardrails:**
  - Owner cannot be demoted or removed.
  - The last admin cannot be demoted.
  - Admin cannot change their own role or remove themselves.
- Removing a user is permanent — they can no longer sign in. Their historical actions remain in the audit log.

### 5.2 Projects

A **Project** is a logical grouping of assets — for example, `prod`, `staging`, `customer-X`, or `payments`. Projects are used for:

- Scoping dashboards and asset lists.
- Applying the project filter everywhere (click a project chip on any asset card → filters the list).
- Grouping findings and setting different notification preferences per environment.

Projects are flat (no nesting). Each asset belongs to at most one project.

### 5.3 Servers

#### Installation

Admin → Servers → **Add Server**:

1. Enter label, project, optional tags.
2. Click **Generate Install Command**. Backend issues a one-time `InstallToken` (24-hour expiry).
3. Dialog shows a ready-to-copy shell command for Linux `amd64` or `arm64`:
   ```bash
   curl -fsSL -o sc-agent https://api.example.com/v1/agents/download?arch=amd64
   chmod +x sc-agent
   sudo ./sc-agent install --token <TOKEN> --api-url https://api.example.com
   sudo ./sc-agent run
   ```
4. `./sc-agent install` registers with the backend, receives a per-agent API key, writes config + systemd unit file. `./sc-agent run` starts the agent.

#### Server detail — split across two pages

The server detail page is split into **Monitoring** and **Security** via a sub-nav tab, with a shared header (score badge, hostname, status chip, project chip, tags, agent version, action bar).

**Monitoring page** (Grafana-inspired):

- **Info cards row**: OS + version, kernel, IPs, CPU cores, RAM, disk, uptime, last heartbeat.
  - OS chip is **color-coded** (red = EOL, orange = EOL in ≤90 days or newer major available, default = current) with hover explanation sourced from a static EOL map (Debian, Ubuntu, RHEL, CentOS, Rocky, AlmaLinux, Fedora).
  - Kernel tooltip shows the full string (no truncation).
  - Uptime is **true server uptime** (from the agent's `bootTime`), not agent-install time.
- **Gauge row**: CPU Busy, Sys Load, RAM Used, SWAP Used, Disk Used — Grafana-style semicircle with green/yellow/red threshold bands.
- **Time range selector**: 1h / 6h / 24h / 3d / 7d.
- **Metric panels** with shared crosshair across panels, each showing:
  - Current value, threshold line
  - Stats strip with per-series min / max / avg / current values (bolded current)
  - CPU Usage (with iowait overlay), Memory (with swap), Disk (with I/O util), Load Avg (1/5/15), Disk I/O (read/write bps), Network Throughput (rx/tx).
- **Docker section**: running/stopped count + container table with image, state, CPU/mem %, restart count.

**Security page**:

- **Posture** tab (default): color-coded chips for firewall / SSH / reboot / SSH failures / exposed ports / shell users / active sessions / audit pass-fail / CIS-mapped controls — each with hover explanations. Clickable "exposed ports" chip reveals the full list, color-coded by exposure (internet / restricted / blocked / localhost) with per-port tooltips explaining why.
- **Vulnerabilities** tab: CVE table matched against the server's package inventory. Filter chips (all / critical / high / medium / low / fix available / CISA KEV). EPSS score column (exploitation probability in 30 days, tooltip shows percentile). "How to fix" tooltips with exact remediation commands. "Run CVE Scan" button to force a re-match against the latest vulnerability feed.
- **Attack Surface** tab: external port scan results from our side of the internet — open ports, service fingerprint, version, risk level, response time, exposed admin panels (WordPress/phpMyAdmin/Portainer/etc.). "Run Scan" button triggers a fresh scan.

**Full Report** (new page): printable one-page summary for compliance audits — score, hardware, posture status, top findings, SSL grade for associated domains.

#### Server list

- **Status cards** (Online / Warning / Critical / Offline) — clickable to filter, click again to clear. Counts reflect tag+project scope.
- **Tag filter** with `key=value, key2=value` syntax, Enter or "Apply" to commit.
- **Project filter** dropdown.
- Tag chips and project chips on each server card are clickable → apply instant filters.

### 5.4 Domains (uptime + SSL + DNS)

#### Add domains

Admin → Domains → **Add Domains**. Single or bulk mode:

- Single: host + port.
- Bulk: paste a list `example.com`, `api.example.com:443`, `internal.corp.net:8443`, one per line.

Each domain can have:

- Custom check **interval** (5s – 3600s, default 15s).
- Custom **timeout** (5s – 120s, default 30s).
- Project + tags.

#### What we check

- **Uptime** (every `interval`): TCP connect + HTTP GET, record `isUp`, `statusCode`, `responseMs`.
- **SSL** (daily): full handshake — cert issuer, expiry, days-left, TLS version, cipher suite, chain validity. Assigns a **grade** (A / A- / B / C / D / F) from a simplified SSL-Labs-style ruleset.
- **DNS** (daily): SPF / DKIM / DMARC records detected.

#### Domain list

- **Status cards** (Healthy / Degraded / Down / Pending) — same click-to-filter pattern as servers.
- **Tag filter**, **project filter** dropdowns.
- Table columns: endpoint + port, status dot, SSL grade badge (round, colored by grade), last-checked relative time, response ms, interval.
- Inline actions: **Check now** (re-run uptime check), **Remove**.
- Clicking a project chip or tag chip filters the list instantly.

#### Domain detail

- Header: status light, host:port, project chip, tags.
- Uptime history chart with up/down markers.
- SSL details card: grade badge, expiry countdown, issuer, TLS version, cipher, cert chain.
- DNS card: SPF / DKIM / DMARC records.
- Settings dialog: change interval/timeout.
- "Scan SSL Now" button forces a re-scan.

### 5.5 Repositories

#### Connect GitHub

Admin → Settings → Integrations → **Connect GitHub**. Two paths:

1. **Personal Access Token (recommended)** — paste a classic PAT with `repo` scope (or fine-grained PAT with repo read access). Supports **GitHub Enterprise Server** (custom base URL + optional SSL verify-off). Backend verifies the token via `GET /user` before saving.
2. **GitHub App (advanced)** — for org-wide installs with webhook delivery. Enter `installationId` + optional `appId`. Requires `GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY` env vars on the platform side.

Same modal supports both — toggle with a chip.

#### Connect GitLab

Paste a GitLab PAT with `api` scope. Supports self-hosted GitLab with custom URL + verify-ssl toggle.

#### Import repositories

Click **Manage Repositories** from the connected integration card. The **Repo Selection Page** lists all repos accessible to the token/installation (paginated, searchable). Pick which ones to import. Each imported repo:

- Stores `provider`, `providerId`, `owner`, `name`, `defaultBranch`, `language`, `cloneUrl`.
- Can be assigned to a project.
- Is scanned on future pushes.

#### Per-repo scans

- **Full scan** on default-branch pushes (via webhook or manual "Run Scan" button).
- **Delta scan** on feature branches.
- Scan outputs typed findings by category (`code_dependencies`, `code_secrets`, `code_configs`, `code_patterns`) that get merged into the unified Findings view.

> **Status note:** the full scan orchestration exists; the `sc-scan` binary is scaffolded but not yet wired to production scans. Current findings surface comes mainly from the server agent.

### 5.6 Findings

The unified cross-asset feed. Every finding has:

- **Source**: `infra_agent`, `code_dependencies`, `code_secrets`, `code_configs`, `code_patterns`, `cert_check`.
- **Severity**: critical / high / medium / low / info.
- **Status**: open / in_progress / resolved / ignored.
- **Title**, **description**, optional **detail** (JSON blob — CVE ID, EPSS, fixed version, remediation command, CIS control mapping, etc.).
- Link back to the originating asset (server, domain, repo).

Filters on the Findings page: severity, status, source, repository, server, pagination. The Finding detail page shows the full raw `detail` JSON, quick-nav to the asset, and mutation actions (mark resolved, change status).

### 5.7 Dashboard overview

The `/` page is the entry point after login:

- **Org-wide security score** (0–100 with letter grade).
- **Asset counters**: servers (online / warning / critical / offline), domains (healthy / degraded / down), repos.
- **Top 5 risks** sorted by severity + EPSS — click to jump to the asset.
- **Recent activity** feed (last N heartbeats, new findings, new scans).

### 5.8 Notifications

Admins can subscribe each organization to **notification preferences** per event type:

- `server_offline`, `server_critical`
- `domain_down`, `domain_ssl_expiring`
- `finding_critical_opened`, `brute_force_detected`, `server_compromise`
- Delivery: email (via SMTP), optional webhook URL.

Per-event-type opt-in. Roadmap: per-project overrides and quiet hours.

### 5.9 Audit log

Every mutation by an authenticated user (create/update/delete on any resource) is appended to `audit_logs` with the actor ID, action, entity type, entity ID, IP, user agent, and diff. Viewable by admins via `GET /api/v1/audit-logs`.

### 5.10 API keys

Admins can mint long-lived API keys with scopes for programmatic access (e.g., CI/CD pipelines marking findings resolved). Stored as `sha256` hashes; a `keyPrefix` enables fast lookup.

### 5.11 External attack surface scan (server-side)

An on-demand scan run from our infrastructure (not from the customer's agent) that enumerates:

- Open TCP ports on the server's public IP.
- Service fingerprints (HTTP banner, TLS version, common DB protocols).
- Exposed admin panels by probing well-known paths (`/wp-admin`, `/phpmyadmin`, `/portainer/`, `/grafana/login`, …).
- Risk level per port (critical / high / medium / low) based on service type + exposure.

Complements the agent's **internal** view with an **external** view — they often disagree, and the disagreement is the actionable data.

---

## 6. Security Model

### 6.1 Authentication

- **Dashboard users**: JWT bearer access token (1h TTL) + HTTP-only refresh cookie (30d, scoped to `/auth/refresh`).
- **Agents** (`sc-agent`): per-agent API key issued at registration, sent in `X-Agent-Key` header.
- **Monitor** (`sc-monitor`): shared API key (`SC_MONITOR_API_KEY`) sent in `X-API-Key` header.
- **External integrations** (GitHub/GitLab webhooks): HMAC-SHA256 signature verification against per-integration webhook secret.

All tokens and secrets are stored as hashes (bcrypt for passwords, SHA-256 for tokens). Raw tokens are returned exactly once at creation and never stored.

### 6.2 Authorization (RBAC)

Permission matrix enforced by `requirePermission()` middleware:

| Permission | owner | admin | member |
|---|:-:|:-:|:-:|
| `view_dashboard` | ✅ | ✅ | ✅ |
| `view_findings` | ✅ | ✅ | ✅ |
| `manage_org` | ✅ | ✅ | — |
| `manage_users` | ✅ | ✅ | — |
| `manage_projects` | ✅ | ✅ | — |
| `manage_endpoints` | ✅ | ✅ | — |
| `manage_repositories` | ✅ | ✅ | — |
| `manage_integrations` | ✅ | ✅ | — |
| `update_findings` | ✅ | ✅ | — |
| `trigger_scans` | ✅ | ✅ | — |
| `create_api_keys` | ✅ | ✅ | — |

### 6.3 Multi-tenancy

Every resource row has an `orgId`. Every authenticated request carries `req.auth.orgId`. Every Prisma query filters by `orgId`. There is no "super-admin" that can view across orgs.

### 6.4 Secrets & encryption

- JWT secrets in env vars (`JWT_SECRET`, `JWT_REFRESH_SECRET`).
- Integration tokens (GitHub/GitLab PATs) currently stored in Prisma's `Integration.config` JSONB in **plaintext** — encryption at rest is on the roadmap (AES-GCM with a rotating key from GCP KMS).
- GitHub App private key in env var.
- SMTP password in env var.
- Passwords: bcrypt cost 12.
- Invitation tokens: 32 random bytes, stored as SHA-256 hash only.

### 6.5 Transport

- Dashboard ↔ API: HTTPS (Cloud Run managed certs).
- Agent ↔ API: HTTPS, outbound-only from the customer's server. No inbound connectivity required.
- CORS: explicit allow-list from `CORS_ORIGINS` env var.

### 6.6 Rate limiting

In-memory rate limit middleware (`src/middleware/rate-limit.ts`) applied to all routes. No distributed rate limit for MVP — acceptable because Cloud Run deploys a single revision and scales conservatively.

---

## 7. Data Model (High-Level)

Prisma schema covers 20 models. Key relationships:

```
Organization (1)─┬─(N) User
                 ├─(N) Invitation      ← pending & accepted invitations
                 ├─(N) ApiKey
                 ├─(N) InstallToken
                 ├─(N) Project ──────(N) Server
                 │                 ├──(N) MonitoredEndpoint
                 │                 └──(N) Repository
                 ├─(N) Integration ──(N) Repository
                 ├─(N) Scan ─────────(N) Finding
                 ├─(N) Finding       ← cross-asset; may link Server/Repo
                 ├─(N) AuditLog
                 └─(N) NotificationPreference

Server (1)──┬─(N) ServerMetricSnapshot   ← time-series metrics (1 row per heartbeat)
            ├─(N) SecurityPosture        ← snapshot per hourly scan
            ├─(N) PackageInventory       ← daily package + binary inventory
            ├─(N) ServerScoreHistory     ← daily score for sparklines
            └─(N) AttackSurfaceScan

MonitoredEndpoint (1)──(N) EndpointHeartbeat  ← uptime + SSL samples
```

Notable fields:

- `Server.tags`, `MonitoredEndpoint.tags` — JSONB arrays of `{key, value}`.
- `Server.bootTime` — true server boot timestamp, used for uptime.
- `SecurityPosture.firewallDetail` — JSONB with detected misconfig issues.
- `SecurityPosture.listeningPorts[].exposure` — enum-like string per port.
- `Finding.detail` — opaque JSONB with source-specific fields (EPSS, CVE ID, fixed version, remediation, CIS control).
- `VulnerabilityFeed` — synced CVE records from OSV.dev (nightly).

All timestamp columns are `@db.Timestamp(3)` (PostgreSQL 16). JSON columns are `@db.JsonB` for indexed querying.

---

## 8. Deployment & Operations

### 8.1 Environments

- **Local dev**: Docker Compose spins up PostgreSQL; `make dev` starts API + dashboard + monitor in the foreground.
- **Production**: GCP Cloud Run (`platform-api`), GCS bucket (`dashboard`), Supabase (PostgreSQL), GCE e2-micro (`sc-monitor`).

### 8.2 CI/CD — GitHub Actions

Five-stage pipeline (`.github/workflows/deploy.yml`) with **path filtering**:

1. **changes** — detect which paths changed (platform-api, dashboard, sc-monitor, prisma).
2. **migrate** — runs only if `prisma/**` changed; applies DB migrations via a one-shot Cloud Run Job.
3. **deploy-api** — builds container, pushes to Artifact Registry, deploys to Cloud Run (agent binaries bundled into the image).
4. **deploy-dashboard** — builds the Vite bundle (injects `VITE_API_URL` + `VITE_BASE_URL`), uploads to GCS.
5. **deploy-monitor** — builds the Go binary, deploys to the e2-micro VM via SSH.

Each stage is retryable individually. Manual dispatch supports `target=all|migrate|api|dashboard|monitor`. Uses Workload Identity Federation (no service-account JSON keys).

### 8.3 Observability

- Structured JSON logs (level + message + request_id + context) written to stdout; Cloud Run captures to Cloud Logging automatically.
- Per-request log line with method/path/status/duration.
- No dedicated metrics endpoint yet; roadmap: Prometheus `/metrics` or OpenTelemetry export.

### 8.4 Backup & recovery

- Supabase daily backups (Point-in-Time Recovery on paid tier).
- `sc-agent` binaries mirrored on GCS so the API container can serve them without a live GitHub release call.

---

## 9. Configuration (Environment Variables)

### Platform API

| Var | Required | Default | Notes |
|---|:-:|---|---|
| `DATABASE_URL` | ✅ | — | Postgres connection string (pooled, e.g., Supabase pgbouncer :6543) |
| `DIRECT_URL` | — | — | Direct Postgres URL used by Prisma for migrations |
| `JWT_SECRET` | ✅ | — | 32+ byte random string |
| `JWT_REFRESH_SECRET` | ✅ | — | 32+ byte random string |
| `CORS_ORIGINS` | — | `http://localhost:5173` | CSV |
| `SC_MONITOR_API_KEY` | ✅ | `sc-monitor-dev-key` | Shared secret with `sc-monitor` |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` | — | empty | Only needed for GitHub App mode |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | — | empty | Any SMTP provider (Resend, Postmark, SES, SendGrid) |
| `SMTP_SECURE` | — | auto | `true` for 465, `false` otherwise (STARTTLS) |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | — | empty | Dev shortcut for Gmail SMTP |
| `MAIL_FROM` | — | `SecurityCentral <${SMTP_USER}>` | Display name + from address |
| `DASHBOARD_BASE_URL` | — | `http://localhost:5173` | Used to build links inside emails |
| `LOG_LEVEL` | — | `info` | fatal / error / warn / info / debug / trace |

### Dashboard (build-time)

| Var | Purpose |
|---|---|
| `VITE_API_URL` | Base URL of the platform API |
| `VITE_BASE_URL` | Base path for the bundle (used when served from a subpath, e.g., GCS bucket root) |

---

## 10. Current State & Roadmap

### Completed (MVP)

- ✅ Authentication & multi-tenant org model
- ✅ Invitation flow with email delivery (SMTP-agnostic)
- ✅ Agent install + heartbeat + metrics + Docker + posture + inventory + suspicious processes
- ✅ Domain monitoring (uptime + SSL grade + DNS)
- ✅ Per-asset security scoring + history
- ✅ Tag/project/status filtering everywhere
- ✅ Dashboard overview + unified findings
- ✅ GitHub PAT / GitHub App / GitLab PAT connections
- ✅ Repo listing + selection for import
- ✅ External attack surface scan
- ✅ Brute-force detection + compromise detection
- ✅ OS EOL detection with hover explanations
- ✅ CIS benchmark mapping
- ✅ CVE matching with EPSS scores and remediation commands
- ✅ Per-server, per-domain printable reports
- ✅ GCP Cloud Run deployment with GitHub Actions CI/CD

### In progress

- ⚠️ `sc-scan` binary integration for actual code scan findings (scaffold exists, not yet wired)
- ⚠️ Webhook → automatic scan on push (pipeline exists, scanner needs to run)
- ⚠️ Proper notification delivery (preferences exist; delivery paths partial)

### Near-term roadmap (next ~1–2 months)

- **Integration secret encryption at rest** (GCP KMS AES-GCM envelope encryption).
- **Per-project notification rules** and quiet hours.
- **Slack / Teams webhook** notifications alongside email.
- **Scan triggering on push** once `sc-scan` is wired.
- **Full code scan** result pipeline (dependencies → CVE match → de-dupe with server findings).
- **Cloud provider integrations** (AWS / GCP / Azure read-only inventory) to surface misconfigured S3 buckets, open security groups, etc.

### Longer term

- **Scheduled security reports** emailed weekly to admins.
- **Incident response runbooks** per finding type.
- **Compliance-mapping dashboards** (SOC 2, ISO 27001 evidence export).
- **Container image registry scanning** (Dockerfile + image layer CVEs).
- **Kubernetes operator** as an alternative to the raw-host agent.

---

## 11. Known Limitations & Caveats

- **Prisma migration history is not in sync** with the current Postgres schema (migrations were originally authored for MySQL, then the project switched to Postgres). Local dev uses `prisma db push`; production schema changes currently bypass the `migrations/` folder. Cleaning up the migration history is on the backlog.
- **No horizontal scaling strategy** for `platform-api` — the in-process scheduler and in-memory rate limiter assume a single instance. Cloud Run's concurrency setting is tuned to 1 revision for now.
- **No WAL/event sourcing** — mutations overwrite in place. Audit log captures intent, not full diffs.
- **No end-to-end tests** (Playwright) yet — only unit/integration tests on the API.
- **Agent version pinning** — agents auto-update to whatever `/v1/agents/version` returns. There's no staged rollout or rollback mechanism yet.
- **No customer-facing billing / plan limits** — `Organization.plan` exists but isn't enforced.

---

## 12. Glossary

- **Finding** — any security-relevant observation (CVE, misconfig, failed audit check, exposed port). Has severity, status, source.
- **Score** — 0–100 integer per asset; computed from open findings with severity weights. Grade: `A` ≥90, `B` ≥75, `C` ≥60, `D` ≥45, `F` otherwise.
- **Posture** — point-in-time snapshot of a server's non-metric security attributes (firewall, SSH, users, ports, audit).
- **Attack surface** — the set of externally reachable ports/services as seen from the public internet.
- **Install token** — one-time 24-hour code used by an agent to register itself and trade it for a long-lived API key.
- **Invitation token** — one-time 7-day code sent to a new user to let them set their own password.
- **EPSS** — Exploit Prediction Scoring System. A probability (0–1) that a given CVE will be exploited in the next 30 days.
- **KEV** — CISA's Known Exploited Vulnerabilities catalog. Used to flag CVEs with confirmed in-the-wild exploitation.
- **CIS Benchmark** — set of industry-standard hardening controls (we map a subset of Linux controls to the agent's audit checklist).
- **Project** — logical grouping of assets inside one organization (e.g., environment, product line).
- **Agent** — the `sc-agent` Go binary running on a customer server.
- **Monitor** — the `sc-monitor` Go binary running on our infrastructure, polling customer domains from outside.

---

## 13. Quick Tour for New Users

Typical first-time flow after signing up:

1. **Invite teammates** — Settings → Team Members → Invite. They receive an email, set their password, and land on the dashboard.
2. **Create a project** — Projects → New Project (e.g., `production`).
3. **Add your first server** — Servers → Add Server. Copy the install command, SSH into your server, paste it. Within 60s the server appears with live CPU/RAM/disk charts and its first security posture scan.
4. **Add your main domain** — Domains → Add Domains. SSL scan runs immediately; you get a grade within 5s.
5. **Connect GitHub** — Settings → Integrations → Connect GitHub. Paste a PAT. Click "Manage Repositories" and import your prod repos.
6. **Check the dashboard** — `/` now shows your overall score, top risks, and which assets need attention.
7. **Set up notifications** — Settings → Notifications. Enable `server_offline` and `finding_critical_opened` to start.

Total time end-to-end: ~5 minutes for 1 server + 1 domain + 1 repo.

---

*This document is a living overview. Keep it updated when features land or shift scope. Source-of-truth docs for implementation live next to the code:*
- *Architecture*: `docs/architecture.md`
- *Product spec*: `docs/securitycentral-spec.md`
- *MVP plan*: `docs/mvp-plan.md`
- *Agent architecture*: `docs/sc-agent-architecture.md`
- *CVE scanning*: `docs/server-cve-scanning.md`
- *UI wireframes*: `docs/ui-wireframes.md`
