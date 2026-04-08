# SecurityCentral — Architecture Document

## 1. System Overview

SecurityCentral is a unified security scanning and monitoring platform with three pillars:

1. **Code Security** — dependency vulnerabilities, secrets detection
2. **Infrastructure Security** — server posture, OS patches, compliance
3. **Domain Security** — SSL/TLS, DNS security, uptime monitoring

Designed for non-security teams at small companies. Emphasis on clarity, low friction, and actionable alerts.

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Google Cloud Platform                       │
│                                                                      │
│  ┌──────────────┐    ┌──────────────────┐    ┌───────────────────┐  │
│  │  Cloud Run    │    │   Cloud Run       │    │  Cloud SQL        │  │
│  │  Dashboard    │    │   Platform API    │    │  MySQL 8          │  │
│  │  (Static SPA) │    │   (Node.js)       │    │                   │  │
│  └──────┬───────┘    └────┬────┬────┬────┘    └────────┬──────────┘  │
│         │                 │    │    │                    │            │
│         │    ┌────────────┘    │    └──────────┐        │            │
│         │    │                 │               │        │            │
│         │    ▼                 ▼               ▼        │            │
│         │  ┌──────────┐  ┌──────────┐  ┌───────────┐   │            │
│         │  │ Memorystore│  │ Cloud    │  │ Artifact  │   │            │
│         │  │ (Redis)   │  │ Storage  │  │ Registry  │   │            │
│         │  └──────────┘  └──────────┘  └───────────┘   │            │
│         │                                               │            │
└─────────┼───────────────────────────────────────────────┼────────────┘
          │                                               │
          │  HTTPS                                  mTLS  │
          │                                               │
    ┌─────▼──────┐                              ┌─────────▼──────────┐
    │  Browser    │                              │  Customer Servers   │
    │  (Users)    │                              │  ┌──────────────┐  │
    └────────────┘                               │  │  sc-agent    │  │
                                                 │  │  (Go binary) │  │
                                                 │  └──────────────┘  │
                                                 └────────────────────┘
```

---

## 3. Deployable Components

| Component | Language | Runtime | GCP Service |
|-----------|----------|---------|-------------|
| **Platform API** | Node.js + TypeScript | Express | Cloud Run |
| **Worker** | Node.js + TypeScript | BullMQ processors | Cloud Run (always-on) |
| **Dashboard** | React + TypeScript | Vite (static build) | Cloud Run or Cloud Storage + CDN |
| **sc-agent** | Go | Single binary (systemd) | Runs on customer servers |
| **sc-scan** | Go | CLI binary | Cloud Run Jobs (triggered by Worker) |
| **sc-certmon** | Go | Container (CronJob) | Cloud Run Jobs (scheduled) |

---

## 4. Component Details

### 4.1 Platform API (Node.js)

The central backend. Modular monolith — each module has its own router, service, and validation layer.

**Modules:**

| Module | Responsibility |
|--------|---------------|
| `auth` | JWT authentication, API key auth, signup/login |
| `agents` | Agent registration, heartbeat handling, findings ingestion |
| `projects` | Logical grouping of repos, servers, endpoints |
| `findings` | Vulnerability CRUD, severity/status, trends, search |
| `scans` | Scan lifecycle (trigger, track, complete, cancel) |
| `monitoring` | Domain/endpoint TLS checks, uptime tracking |
| `integrations` | GitHub, GitLab, Slack, cloud provider OAuth |
| `notifications` | Alert delivery (email, Slack, webhook) |
| `dashboard` | Aggregated metrics and security posture overview |
| `organizations` | Multi-tenant isolation, settings, onboarding |
| `audit` | Immutable change history with actor attribution |

**Middleware stack** (in order): helmet → compression → CORS → JSON parser → request-id tracing → request logger → rate limiting → auth → RBAC → Zod validation → error handler.

**API format:**
```
Success: { success: true, data: {...}, meta?: { total, page, limit } }
Error:   { success: false, error: { code, message } }
```

All routes versioned under `/api/v1/*`. Agent endpoints at `/v1/agents/*` with separate rate limits.

### 4.2 Scheduled Tasks (in-process)

For MVP, async work runs in-process via `setInterval`/`setTimeout` within the Platform API process. No separate worker or Redis required.

| Task | Interval | Purpose |
|------|----------|---------|
| Domain monitoring | Per endpoint `checkInterval` (1h/6h/24h) | TLS/HTTP/DNS checks on monitored endpoints |
| Offline detection | Every 5 minutes | Detect agents that missed heartbeats |

> **Future:** Extract to BullMQ workers backed by Redis for horizontal scaling, retry guarantees, and concurrency control. The queue architecture is designed but deferred.

### 4.3 Dashboard (React + Vite + MUI)

Single-page application. MUI v7 component library, React Query for server state, Socket.IO for real-time updates.

**Pages:**

| Page | Description |
|------|-------------|
| Dashboard | Security posture overview, findings by severity, trends |
| Projects | Asset grouping — repos, servers, endpoints per project |
| Findings | Filterable vulnerability list with drill-down detail |
| Scans | Scan history, trigger manual scans |
| Monitoring | Domain/endpoint TLS and uptime monitoring |
| Integrations | Connect GitHub, GitLab, Slack, cloud providers |
| Settings | Organization and user preferences |
| Onboarding | Setup wizard for first-time users |

**Data flow:** Components → React Query hooks → typed fetch client (`/api/v1/*`) → JWT Bearer auth → auto-refresh on 401. WebSocket events (`finding:new`, `scan:completed`, `agent:connected`, etc.) trigger query invalidation for real-time UI updates.

### 4.4 sc-agent (Go)

Infrastructure scanning agent. Installed on customer servers as a systemd service.

**Commands:**
- `run` — continuous agent with heartbeat loop + scheduled scanning
- `install --token <TOKEN>` — one-time provisioning with install token
- `update` — self-update binary from platform API
- `uninstall` — remove agent from server
- `status` — local diagnostic health check

**Adaptive heartbeat (two-tier loop):**

The agent runs two concurrent loops — a fast local collector and a slower network sender:

```
┌─ Collect loop (every 1s) ─────────────────────────────────┐
│  Sample CPU, RAM, disk, open ports, process list           │
│  Run lightweight error checks against thresholds           │
│                                                            │
│  ● Error detected? → push to alert buffer                  │
│  ● No error?       → push to metrics ring buffer           │
└────────────────────────────────────────────────────────────┘

┌─ Send loop ───────────────────────────────────────────────┐
│  IF alert buffer non-empty AND ≥15s since last send:      │
│     → POST /v1/agents/heartbeat (urgent: true)            │
│       includes: alerts + recent metrics snapshot           │
│                                                            │
│  ELSE every 60s (normal heartbeat):                        │
│     → POST /v1/agents/heartbeat (urgent: false)           │
│       includes: aggregated metrics (avg/max over 60s)     │
│                                                            │
│  ← Response: { commands[], config{}, renewedCert? }       │
└───────────────────────────────────────────────────────────┘
```

| Condition | Behavior |
|-----------|----------|
| Steady state (no errors) | Collect every 1s, send aggregated heartbeat every 60s |
| Error detected | Collect every 1s, send urgent heartbeat after 15s debounce |
| Consecutive errors within 15s | Batched into single urgent heartbeat (no flood) |
| Error clears before 15s | Downgraded to normal 60s heartbeat |

**Error conditions that trigger urgent heartbeat:**
- CPU > 85% sustained, RAM > 85%, Disk > 90%
- New unexpected open port
- Critical service down
- Disk I/O errors
- Agent self-check failures

**Heartbeat payload:**
```json
{
  "agentId": "...",
  "urgent": true,
  "alerts": [
    { "type": "cpu_high", "value": 92, "threshold": 85, "since": "..." }
  ],
  "metrics": {
    "cpu": { "avg": 45, "max": 92 },
    "ram": { "avg": 60, "max": 78 },
    "disk": { "usage": 72, "ioErrors": 0 }
  },
  "system": { "hostname": "...", "os": "...", "agentVersion": "..." }
}
```

Platform responds with commands: `scan_now`, `update_vulndb`, `shutdown`.

**Findings upload (separate from heartbeat):**
```
Agent → POST /v1/agents/findings → Platform
       ← { scanId, created, updated, resolved }
```

**Scanning capabilities:**
- **OS packages** — dpkg (Debian/Ubuntu), rpm (CentOS/RHEL/Rocky), apk (Alpine)
- **Compliance** — SSH config, firewall, user privileges, file permissions, open ports
- **Secrets** — pattern-based detection with entropy filtering

**Resilience:** mTLS with cert renewal, exponential backoff retries (1s→30s, 5 attempts), rollback watchdog for failed updates, local metrics persistence at `/var/lib/securitycentral/metrics.json`.

### 4.5 sc-scan (Go)

Code scanner triggered by the platform. The Worker dispatches scan jobs → sc-scan clones the repository, runs analysis, and reports findings back to the Platform API. Shared `internal/` packages with sc-agent.

**Scanning capabilities:**
- **Dependencies** — npm (package-lock.json), pip (requirements.txt, poetry.lock), Maven (pom.xml)
- **Secrets** — API keys, AWS creds, private keys, tokens (GitHub, Slack, etc.)
- Matches against local vulnerability database with affected version range detection

### 4.6 sc-certmon (Go)

Certificate discovery and monitoring. Runs as a scheduled container.

**Capabilities:**
- **AWS discovery** — finds certs on ALB/NLB HTTPS listeners via ACM
- **Health checks** — expiry warnings (30/14/7 days), hostname mismatch, weak keys (RSA <2048, ECDSA <256), weak signature algorithms (MD5, SHA1), self-signed detection, chain validation, wildcard detection, CAA record validation

---

## 5. Data Architecture

### 5.1 Database — MySQL 8 (Cloud SQL)

Primary data store. ORM: **Prisma** with MySQL adapter.

**Core entities:**

```
Organization (multi-tenant root)
├── User (role: owner|admin|member|viewer)
├── ApiKey (hashed, scoped, prefix-based lookup)
├── InstallToken (agent provisioning)
├── Project
│   ├── Repository (provider: github|gitlab|bitbucket)
│   ├── Server (hostname, agentId, osFamily, lastHeartbeat)
│   └── MonitoredEndpoint (host, port, checkInterval)
├── Scan (type, status, trigger, duration, findingsTotal)
├── Finding (source, severity, status, cveId, cvssScore, detail JSON)
├── Certificate (subjectCn, sans[], issuer, notAfter, fingerprint)
├── Integration (provider, OAuth config)
├── AuditLog (actor, action, entityType, old/new values)
└── NotificationPreference (channel, eventType)
```

**Key design decisions:**
- All entities scoped by `orgId` for tenant isolation
- Findings have a `source` enum: `code_scanner | infra_agent | cert_monitor`
- Scan types: `code_dependencies | code_secrets | infra_packages | infra_compliance | cert_discovery | cert_check`
- Finding status lifecycle: `open → in_progress → resolved | suppressed | false_positive`
- Severity levels: `critical | high | medium | low | info`
- CVE data stored in `Vulnerability` + `VulnerabilityAffects` (ecosystem, package, version range)

### 5.2 Redis (deferred)

Not used in MVP. All async work runs in-process. Add Redis later for:
- BullMQ job queues (horizontal scaling)
- Socket.IO adapter (multi-instance WebSocket)
- Rate limiting (distributed counters)
- Session cache

### 5.3 Search (deferred)

Elasticsearch/OpenSearch as a read replica for findings full-text search and aggregation.

---

## 6. Security Architecture

### 6.1 Authentication

| Actor | Method |
|-------|--------|
| Browser users | JWT Bearer token + HttpOnly refresh cookie |
| CI/CD / automation | API key (`X-API-Key: sc_live_...`) — hashed in DB |
| Go agents | API key (`X-Agent-Key`) — mTLS deferred |

### 6.2 Authorization

4-tier RBAC: `viewer → member → admin → owner`. Permission matrix per role. API keys have scoped permissions.

### 6.3 Agent Security

- **Install tokens** — one-time use, hashed storage, configurable expiry
- **mTLS** — agent and platform mutually authenticate via TLS client certs
- **Certificate renewal** — integrated into heartbeat loop, auto-renew before expiry
- **Binary signing** — Ed25519 signatures on agent binaries, verified before execution
- **Self-update** — download from platform, verify signature, rollback watchdog on failure

### 6.4 Multi-Tenancy

All data queries scoped by `orgId`. No cross-tenant data access. Rate limiting per org.

---

## 7. Real-Time Architecture

```
Platform API ──emit──▶ Socket.IO server ──▶ Browser clients (org-scoped rooms)
```

**Events:**
- `finding:new` — new high-severity finding
- `finding:resolved` — finding resolved
- `scan:started` / `scan:completed` — scan lifecycle
- `agent:connected` / `agent:disconnected` — agent status
- `cert:expiring` — certificate expiration warning

Clients join org-scoped rooms on connect. JWT validated in Socket.IO handshake.

---

## 8. GCP Deployment Architecture

### 8.1 Services

| Component | GCP Service | Config |
|-----------|-------------|--------|
| Platform API | Cloud Run | min 1 instance, autoscale to 10 |
| Dashboard | Cloud Run (or Cloud Storage + Cloud CDN) | static SPA, CDN-cached |
| MySQL | Cloud SQL (MySQL 8) | Private IP, automated backups |
| Agent binaries | Cloud Storage | versioned binary hosting for agent self-update |
| Secrets | Secret Manager | API keys, JWT secrets, OAuth tokens |
| Container images | Artifact Registry | Docker images for containerized services |

> **Later:** Add Memorystore (Redis) for BullMQ workers and Socket.IO multi-instance adapter.

### 8.2 Networking

```
Internet ──▶ Cloud Load Balancer (HTTPS)
              ├──▶ /api/*     → Cloud Run: Platform API
              ├──▶ /ws/*      → Cloud Run: Platform API (WebSocket)
              └──▶ /*         → Cloud Run: Dashboard (or CDN)

Customer Servers ──HTTPS + API Key──▶ Cloud Run: Platform API (/v1/agents/*)
```

- Cloud Run services in **VPC connector** for private Cloud SQL access
- Agent traffic over public internet with HTTPS + API key auth (mTLS deferred)
- Cloud SQL with private IP only (no public access)

### 8.3 CI/CD (deploying SecurityCentral itself)

```
GitHub push → Cloud Build
  ├── Build & test Platform API → Deploy to Cloud Run
  ├── Build Dashboard → Deploy static assets
  ├── Build Go binaries (sc-agent, sc-scan, sc-certmon) → Upload to Cloud Storage (signed)
  └── Run Prisma migrations → Cloud SQL
```

### 8.4 Monitoring & Logging

- **Cloud Logging** — structured logs from all Cloud Run services
- **Cloud Monitoring** — latency, error rate, instance count alerts
- **Error Reporting** — automatic error grouping and notification
- **Uptime Checks** — platform API health endpoint monitoring

---

## 9. Scoring Model

Each asset (repository, server, domain) has a **Security Score (0–100)**.

Inputs:
- Severity of open findings (critical=high weight, info=low weight)
- Recency of patches / last scan
- Exposure level (public-facing vs internal)
- Stability (repeat alerts, unresolved issues over time)

Score must be **explainable** — each factor contributing to the score is visible with a "why" breakdown.

---

## 10. Data Flow Diagrams

### 10.1 Code Scan Flow

```
User triggers scan (or scheduled / GitHub webhook)
  → Platform API → scan-orchestration queue
    → Worker clones repo → runs sc-scan (deps + secrets)
      → Findings stored in MySQL
      → es-sync queue → Search index
      → notifications queue → Slack/email
      → github-pr queue → auto-fix PR (if applicable)
        → Dashboard updated via WebSocket
```

### 10.2 Infrastructure Scan Flow

```
sc-agent (on customer server)
  → heartbeat every 60s → POST /v1/agents/heartbeat
    ← commands: [scan_now] (or scheduled)
  → runs scanners (packages, compliance, secrets)
  → POST /v1/agents/findings
    → Findings stored in MySQL → Dashboard updated via WebSocket
```

### 10.3 Domain Monitoring Flow

```
In-process scheduler (per endpoint checkInterval: 1h/6h/24h)
  → API checks TLS, HTTP headers, DNS records, uptime
    → Findings + EndpointHeartbeat stored in MySQL
      → cert:expiring WebSocket event if applicable
        → Dashboard updated in real-time
```

---

## 11. Technology Summary

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, MUI v7, React Query v5, Socket.IO client, Recharts |
| Backend API | Node.js, TypeScript, Express, Prisma ORM |
| Database | MySQL 8 (Cloud SQL) |
| Real-time | Socket.IO (standalone, no Redis adapter for MVP) |
| Scanning Agents | Go 1.22, Cobra CLI, single-binary |
| Agent Comms | HTTPS + API key (mTLS deferred) |
| Cloud | GCP: Cloud Run, Cloud SQL, Cloud Storage, Secret Manager, Artifact Registry |
| CI/CD | Cloud Build (or GitHub Actions) |

**Deferred:**
| Layer | Technology |
|-------|-----------|
| Job Queue | BullMQ on Redis |
| Cache / Pub-Sub | Redis (Memorystore) |
| Search | Elasticsearch / OpenSearch |
| Agent Signing | Ed25519 binary verification |
