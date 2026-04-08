# SecurityCentral MVP — Implementation Plan

## 1. Overview

SecurityCentral is a lightweight infrastructure security and monitoring platform for small companies. This document describes the MVP implementation plan covering: domain SSL/uptime monitoring, server monitoring via Go agent, basic security scoring, and a unified dashboard.

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, MUI v7, React Query v5, Recharts |
| Backend API | Node.js, TypeScript, Express, Prisma ORM |
| Database | MySQL 8 (Cloud SQL) |
| Real-time | Socket.IO (standalone, no Redis adapter for MVP) |
| Server Agent | Go 1.22, Cobra CLI, single binary (systemd) |
| Agent Auth | API key (`X-Agent-Key` header) |
| Cloud | GCP: Cloud Run, Cloud SQL, Cloud Storage |

> **Deferred:** Redis + BullMQ job queues. All async work (domain checks, notifications) runs in-process via `setInterval`/`setTimeout` for MVP. Redis can be added later for horizontal scaling.

### MVP Scope

**In scope:**
- Domain SSL/TLS, DNS security (SPF/DKIM/DMARC), uptime monitoring
- Server metrics (CPU/RAM/disk) via Go agent with adaptive heartbeat
- Server OS/patch visibility
- Basic security scoring (0–100 per asset)
- Dashboard with drill-down
- Projects to group assets

**Deferred:**
- Redis + BullMQ (async jobs run in-process for MVP)
- Code scanning (repo dependencies, secrets)
- OpenSearch / Elasticsearch
- mTLS agent authentication
- Binary signing (Ed25519)
- Compliance reports, automated remediation, team roles

### Key Decisions (changed from v1)

| Decision | Rationale |
|----------|-----------|
| MySQL 8 instead of PostgreSQL | Cloud SQL MySQL, team familiarity |
| No Redis/BullMQ for MVP | Async work runs in-process; add Redis later for scaling |
| No OpenSearch for MVP | MySQL queries sufficient, reduces infrastructure |
| API key auth for agents (not mTLS) | Simpler onboarding, mTLS added in phase 2 |
| No code scanning in MVP | Focus on infrastructure monitoring first |
| Adaptive heartbeat (new design) | Faster anomaly detection without flooding the server |

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                      Google Cloud Platform                        │
│                                                                   │
│  ┌─────────────┐   ┌──────────────────┐   ┌──────────────────┐  │
│  │ Cloud Run    │   │ Cloud Run         │   │ Cloud SQL        │  │
│  │ Dashboard    │   │ Platform API      │   │ MySQL 8          │  │
│  │ (Static SPA) │   │                   │   │                  │  │
│  └──────┬──────┘   └───┬──────┬───────┘   └───────┬──────────┘  │
│         │               │      │                    │             │
│         │               │      └──────────┐         │             │
│         │               │                 ▼         │             │
│         │               │          ┌───────────┐    │             │
│         │               │          │ Cloud     │    │             │
│         │               │          │ Storage   │    │             │
│         │               │          └───────────┘    │             │
└─────────┼──────────────────────────────────────────┼─────────────┘
          │ HTTPS                               HTTPS│+ API Key
          │                                          │
    ┌─────▼──────┐                         ┌─────────▼────────────┐
    │  Browser    │                         │  Customer Servers     │
    │  (Users)    │                         │  ┌────────────────┐  │
    └────────────┘                          │  │  sc-agent (Go) │  │
                                            │  └────────────────┘  │
                                            └──────────────────────┘
```

### Deployable Components

| Component | Language | GCP Service |
|-----------|----------|-------------|
| Platform API | Node.js + TypeScript | Cloud Run |
| Dashboard | React + TypeScript (Vite) | Cloud Run or CDN |
| sc-agent | Go binary (systemd) | Customer servers |

> **Note:** No separate Worker process for MVP. Domain checks and scheduled tasks run in-process via `setInterval`. A BullMQ worker can be extracted later.

### Service Ports (local dev)

| Service | Port |
|---------|------|
| Platform API | 3000 |
| Dashboard (Vite) | 5173 |
| MySQL | 3306 |

---

## 3. Data Model

### Prisma Schema (MySQL 8)

**Adaptations from archived PostgreSQL schema:**
- `@default(uuid()) @db.VarChar(36)` for all IDs (no `gen_random_uuid()`)
- `@db.DateTime(3)` replaces `@db.Timestamptz()`
- `@db.Json` replaces `@db.JsonB`
- `String[]` → `Json @default("[]")` (MySQL has no native string arrays)

**Core Models:**

```
Organization (multi-tenant root)
├── User (role: owner | admin | member | viewer)
├── ApiKey (hashed, scoped, prefix-based)
├── InstallToken (agent provisioning, one-time use)
├── Project (logical asset grouping)
│   ├── Server (hostname, agentId, osFamily, lastHeartbeat)
│   └── MonitoredEndpoint (host, port, checkInterval)
├── Scan (type, status, trigger, duration, findingsTotal)
├── Finding (source, severity, status, cveId, cvssScore, detail JSON)
├── ServerMetricSnapshot (NEW — time-series CPU/RAM/disk from heartbeats)
├── EndpointHeartbeat (uptime check results)
├── Integration (provider: github | gitlab | slack)
├── AuditLog (actor, action, entityType, old/new values)
└── NotificationPreference (channel, eventType)
```

**New Model — ServerMetricSnapshot:**

```prisma
model ServerMetricSnapshot {
  id        String   @id @default(uuid()) @db.VarChar(36)
  serverId  String   @map("server_id") @db.VarChar(36)
  cpu       Float
  memory    Float
  disk      Float
  urgent    Boolean  @default(false)
  alerts    Json     @default("[]") @db.Json
  createdAt DateTime @default(now()) @map("created_at") @db.DateTime(3)

  server Server @relation(fields: [serverId], references: [id])

  @@index([serverId, createdAt])
  @@map("server_metric_snapshots")
}
```

**Enums:**
- `FindingSource`: code_scanner | infra_agent | cert_monitor
- `SeverityLevel`: critical | high | medium | low | info
- `FindingStatus`: open | in_progress | resolved | suppressed | false_positive
- `ScanType`: code_dependencies | code_secrets | infra_packages | infra_compliance | cert_discovery | cert_check
- `ScanStatus`: pending | running | completed | failed | cancelled

---

## 4. Adaptive Heartbeat (sc-agent)

The Go agent runs two concurrent loops — a fast local collector and a slower network sender.

### Collect Loop (every 1s)

```
Sample CPU, RAM, disk, open ports, process list
Run lightweight threshold checks:
  ● Error detected? → push to alert buffer
  ● No error?       → push to metrics ring buffer
```

### Send Loop

```
IF alert buffer non-empty AND ≥15s since last send:
   → POST /v1/agents/heartbeat (urgent: true)
     includes: alerts + recent metrics snapshot

ELSE every 60s (normal heartbeat):
   → POST /v1/agents/heartbeat (urgent: false)
     includes: aggregated metrics (avg/max over 60s)

← Response: { commands[], config{}, renewedCert? }
```

### Behavior Table

| Condition | Behavior |
|-----------|----------|
| Steady state (no errors) | Collect every 1s, send aggregated heartbeat every 60s |
| Error detected | Collect every 1s, send urgent heartbeat after 15s debounce |
| Consecutive errors within 15s | Batched into single urgent heartbeat (no flood) |
| Error clears before 15s | Downgraded to normal 60s heartbeat |

### Error Thresholds (trigger urgent heartbeat)

- CPU > 85% sustained
- RAM > 85%
- Disk > 90%
- New unexpected open port
- Critical service down
- Disk I/O errors

### Heartbeat Payload

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

---

## 5. Scoring Model

Each asset (server, domain) gets a **Security Score (0–100)**.

### Algorithm

```
score = 100
for each open finding:
  if severity == critical: score -= 25
  if severity == high:     score -= 15
  if severity == medium:   score -= 8
  if severity == low:      score -= 3
  if severity == info:     score -= 1
score = max(0, score)
```

### Response Format

```json
{
  "score": 62,
  "breakdown": [
    { "severity": "critical", "count": 1, "deduction": -25 },
    { "severity": "medium", "count": 2, "deduction": -16 }
  ]
}
```

Score must be **explainable** — breakdown always visible in UI.

---

## 6. API Design

### Authentication

| Actor | Method |
|-------|--------|
| Browser users | JWT Bearer token + HttpOnly refresh cookie |
| CI/CD / automation | API key (`X-API-Key: sc_live_...`) |
| Go agents | API key (`X-Agent-Key: ...`) |

### Response Envelope

```json
// Success
{ "data": { ... }, "meta": { "total": 42, "page": 1, "limit": 20 }, "errors": [] }

// Error
{ "data": null, "meta": null, "errors": [{ "code": "NOT_FOUND", "message": "...", "status": 404 }] }
```

### Endpoints

```
Auth
  POST   /auth/register
  POST   /auth/login
  POST   /auth/refresh

Projects
  GET    /api/v1/projects
  POST   /api/v1/projects
  GET    /api/v1/projects/:id
  PATCH  /api/v1/projects/:id
  DELETE /api/v1/projects/:id
  GET    /api/v1/projects/:id/summary

Monitoring (Domains)
  GET    /api/v1/monitoring/endpoints
  POST   /api/v1/monitoring/endpoints
  GET    /api/v1/monitoring/endpoints/:id
  DELETE /api/v1/monitoring/endpoints/:id
  POST   /api/v1/monitoring/endpoints/:id/check
  GET    /api/v1/monitoring/endpoints/:id/heartbeats

Servers
  GET    /api/v1/servers
  GET    /api/v1/servers/:id
  GET    /api/v1/servers/:id/metrics

Agents
  POST   /v1/agents/register
  POST   /v1/agents/heartbeat
  POST   /v1/agents/findings
  GET    /api/v1/install-tokens
  POST   /api/v1/install-tokens

Findings
  GET    /api/v1/findings
  GET    /api/v1/findings/:id
  PATCH  /api/v1/findings/:id

Dashboard
  GET    /api/v1/dashboard/summary
  GET    /api/v1/dashboard/top-risks
  GET    /api/v1/dashboard/assets

Health
  GET    /health
```

---

## 7. Scheduled Tasks (in-process)

No Redis or BullMQ for MVP. Async work runs in-process via `setInterval`:

| Task | Interval | Purpose |
|------|----------|---------|
| Domain monitoring | Per endpoint `checkInterval` (1h/6h/24h) | TLS/HTTP/DNS checks |
| Offline detection | Every 5 minutes | Detect agents that missed heartbeats |

> **Later:** Extract to BullMQ workers backed by Redis for horizontal scaling and retry guarantees.

---

## 8. WebSocket Events

```
finding:new         — New high-severity finding
finding:resolved    — Finding resolved
scan:completed      — Domain check completed
agent:connected     — Agent came online
agent:disconnected  — Agent went offline
cert:expiring       — Certificate expiration warning
```

Clients join org-scoped rooms. JWT validated in Socket.IO handshake. Single-instance for MVP (no Redis adapter needed).

---

## 9. Frontend Pages

| Page | Description |
|------|-------------|
| Login / Register | Auth flow with JWT |
| Dashboard | Security posture overview, severity cards, trends chart, top risks |
| Projects | Project list + create, project detail with linked assets |
| Domains | Domain list with SSL grade, add-domain flow, endpoint detail |
| Servers | Server list with health cards, server detail with live metrics |
| Findings | Filterable vulnerability list with drill-down |
| Settings | Org settings, notification preferences, API keys |
| Onboarding | Guided setup: create project → add domain → install agent |

---

## 10. Phased Implementation

### Phase 0: Foundation
**Goal:** Docker boots MySQL + Redis. API serves `/health`. Dashboard renders login → app shell.

| Component | What |
|-----------|------|
| Infrastructure | `docker-compose.yml` (MySQL 8), Makefile |
| Backend | Express + middleware stack, Prisma schema (MySQL), auth module |
| Frontend | Vite + React + MUI, API client, theme, auth flow, AppShell |

**Done when:** Register → Login → see empty app shell with sidebar

---

### Phase 1: Projects + Domain Monitoring
**Goal:** Users create projects, add domains, see SSL/uptime/DNS check results.

| Component | What |
|-----------|------|
| Backend | Projects CRUD, monitoring module, domain check service (in-process scheduler) |
| Frontend | Projects list/detail, domain list, endpoint detail (SSL, uptime, DNS) |

**Done when:** Create project → add `google.com` → see SSL cert info, TLS version, SPF/DKIM/DMARC

---

### Phase 2: Server Monitoring + Go Agent
**Goal:** Go agent on server sends adaptive heartbeats, dashboard shows live metrics.

| Component | What |
|-----------|------|
| Go Agent | Cobra CLI, adaptive heartbeat (collect 1s, send 15s/60s), sysinfo, API key auth |
| Backend | Agent registration, heartbeat endpoint, install tokens, server CRUD, metric snapshots |
| Frontend | Server list, server detail (CPU/RAM/disk charts, OS info, alerts) |

**Done when:** Install agent → heartbeats arrive → spike CPU → urgent heartbeat within 15s

---

### Phase 3: Scoring + Findings + Dashboard
**Goal:** Security scores (0–100) per asset, findings list, dashboard overview.

| Component | What |
|-----------|------|
| Backend | Scoring engine, findings CRUD, dashboard summary, auto-create findings from checks |
| Frontend | ScoreBadge component, dashboard overview, findings list, score on detail pages |

**Done when:** Domains and servers show scores with "why" breakdown, dashboard shows top risks

---

### Phase 4: Real-Time + Polish
**Goal:** WebSocket updates, notifications, onboarding, deployment.

| Component | What |
|-----------|------|
| Backend | Socket.IO setup (no Redis adapter), offline detection (setInterval), org settings, audit logs |
| Frontend | WebSocket client, real-time query invalidation, settings page, onboarding wizard |
| Deployment | Dockerfiles (API, Dashboard), Go cross-compile (linux/amd64 + arm64) |

**Done when:** Dashboard updates in real-time, `docker compose up` boots entire stack

---

### Phase Dependency Graph

```
Phase 0 (Foundation)
  ├── Phase 1 (Projects + Domains) ──┐
  │                                   ├── Phase 3 (Scoring + Findings)
  └── Phase 2 (Servers + Agent) ─────┘         │
                                          Phase 4 (Real-Time + Polish)
```

Phases 1 and 2 can be built in parallel. Phase 3 requires both.

---

## 11. Project Structure

```
SecurityCentral/
├── docker-compose.yml
├── Makefile
├── CLAUDE.md
├── docs/
│   ├── securitycentral-spec.md
│   ├── architecture.md
│   ├── ui-wireframes.md
│   └── mvp-plan.md
├── platform-api/
│   ├── package.json
│   ├── tsconfig.json
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── seed.ts
│   └── src/
│       ├── server.ts
│       ├── app.ts
│       ├── scheduler.ts              # In-process scheduled tasks (domain checks, offline detection)
│       ├── lib/
│       │   ├── env.ts
│       │   ├── prisma.ts
│       │   ├── jwt.ts
│       │   ├── logger.ts
│       │   └── scoring.ts
│       ├── middleware/
│       │   ├── auth.ts
│       │   ├── errors.ts
│       │   ├── validate.ts
│       │   ├── cors.ts
│       │   ├── rate-limit.ts
│       │   ├── request-id.ts
│       │   ├── request-logger.ts
│       │   └── rbac.ts
│       ├── modules/
│       │   ├── auth/
│       │   ├── projects/
│       │   ├── monitoring/
│       │   ├── agents/
│       │   ├── assets/
│       │   ├── findings/
│       │   ├── dashboard/
│       │   ├── notifications/
│       │   ├── organizations/
│       │   └── audit/
│       └── ws/
│           ├── server.ts
│           └── hooks.ts
├── dashboard/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── api/
│       │   ├── client.ts
│       │   └── hooks.ts
│       ├── theme/
│       │   └── theme.ts
│       ├── auth/
│       │   ├── AuthContext.tsx
│       │   └── ProtectedRoute.tsx
│       ├── ws/
│       │   └── client.ts
│       ├── components/
│       │   ├── AppShell.tsx
│       │   ├── ScoreBadge.tsx
│       │   └── AddServerDialog.tsx
│       └── pages/
│           ├── Login/
│           ├── Register/
│           ├── DashboardOverview/
│           ├── Projects/
│           ├── Monitoring/
│           ├── Servers/
│           ├── Findings/
│           ├── Settings/
│           └── Onboarding/
└── sc-agent/
    ├── go.mod
    ├── Makefile
    ├── cmd/
    │   └── sc-agent/
    │       └── main.go
    ├── internal/
    │   ├── agent/
    │   │   ├── heartbeat.go
    │   │   ├── collector.go
    │   │   ├── thresholds.go
    │   │   ├── scheduler.go
    │   │   ├── status.go
    │   │   └── shutdown.go
    │   ├── sysinfo/
    │   │   ├── sysinfo.go
    │   │   └── resources.go
    │   ├── config/
    │   │   └── agentconfig.go
    │   ├── platform/
    │   │   └── client.go
    │   └── logging/
    │       └── logging.go
    └── pkg/
        └── models/
            ├── finding.go
            └── scan.go
```

---

## 12. Dev Commands

```bash
# Infrastructure
docker compose up -d          # Start MySQL
docker compose down           # Stop infrastructure

# Platform API
cd platform-api
npm install                   # Install dependencies
npx prisma migrate dev        # Run migrations
npx prisma db seed            # Seed test data
npm run dev                   # Dev server (port 3000, includes scheduler)
npm test                      # Run tests

# Dashboard
cd dashboard
npm install
npm run dev                   # Vite dev server (port 5173)
npm test

# Go Agent
cd sc-agent
go build -o bin/sc-agent ./cmd/sc-agent
GOOS=linux GOARCH=amd64 go build -o bin/sc-agent-linux-amd64 ./cmd/sc-agent

# All at once
make start                    # Docker + API + Worker + Dashboard
make stop                     # Stop all
make test                     # Run all tests
make build                    # Build all components
```
