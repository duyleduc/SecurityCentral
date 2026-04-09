# SecurityCentral MVP — Task List

Derived from [mvp-plan.md](./mvp-plan.md) and [ui-wireframes.md](./ui-wireframes.md).

**Phases 1 & 2 can be built in parallel. Phase 3 requires both. Phase 4 is last.**

```
Phase 0 (Foundation)
  ├── Phase 1 (Projects + Domains) ──┐
  │                                   ├── Phase 3 (Scoring + Findings)
  └── Phase 2 (Servers + Agent) ─────┘         │
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

## Phase 3: Scoring + Findings + Dashboard

**Goal:** Security scores (0–100) per asset, findings list, dashboard overview.

### Backend

- [ ] Scoring engine (`lib/scoring.ts`) — calculate score per asset with severity-based deductions, return breakdown
- [ ] Findings CRUD — `GET /api/v1/findings`, `GET /api/v1/findings/:id`, `PATCH /api/v1/findings/:id` (status transitions)
- [ ] Auto-create findings from domain checks (SSL issues, DNS gaps, downtime)
- [ ] Auto-create findings from agent alerts (CPU/RAM/disk threshold breaches)
- [ ] Dashboard summary — `GET /api/v1/dashboard/summary`
- [ ] Dashboard top risks — `GET /api/v1/dashboard/top-risks`
- [ ] Dashboard assets — `GET /api/v1/dashboard/assets`

### Frontend

- [ ] `ScoreBadge` component (color-coded 0–100 with breakdown tooltip)
- [ ] Dashboard overview page (severity cards, trends line chart, recent alerts, score cards per asset type)
- [ ] Findings list page (filterable by severity, source, status; drill-down to detail)
- [ ] Add scores to server detail and domain detail pages

### Done when

Domains and servers show scores with "why" breakdown. Dashboard shows top risks.

---

## Phase 4: Real-Time + Polish

**Goal:** WebSocket updates, notifications, onboarding, deployment.

### Backend

- [ ] Socket.IO server setup (`ws/server.ts`) — JWT handshake, org-scoped rooms
- [ ] WebSocket event hooks (`ws/hooks.ts`) — emit `finding:new`, `finding:resolved`, `scan:completed`, `agent:connected`, `agent:disconnected`, `cert:expiring`
- [ ] Offline detection — `setInterval` every 5 min, flag agents that missed heartbeats
- [ ] Org settings + notification preferences module
- [ ] Audit log module

### Frontend

- [ ] WebSocket client (`ws/client.ts`) — connect, reconnect, handle events
- [ ] Real-time React Query invalidation on WebSocket events
- [ ] Settings page (org settings, notification preferences, API keys management)
- [ ] Onboarding wizard (create project → add domain → install agent)

### Deployment

- [ ] Dockerfile for platform-api
- [ ] Dockerfile for dashboard
- [ ] Go cross-compile in Makefile (`linux/amd64` + `linux/arm64`)
- [ ] Update `docker-compose.yml` to boot entire stack

### Done when

Dashboard updates in real-time. `docker compose up` boots entire stack.
