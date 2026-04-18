# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SecurityCentral is a lightweight infrastructure security and monitoring platform for small companies. Unified view of code repositories (security scanning), servers (health + security posture), and domains (SSL/TLS, DNS, uptime). Designed for non-security teams — emphasis on clarity, low setup friction, and actionable alerts.

Product spec: `docs/securitycentral-spec.md`  
MVP plan: `docs/mvp-plan.md`  
Task tracking: `docs/task-list.md`

## Current State

Rebuilding from scratch. Previous implementation preserved in `archived/` for reference only — do not modify files there. New code goes in the project root.

**Completed:** Phase 0 (Foundation) + Phase 1 (Projects + Domains) + Phase 2 (Servers + Go Agent)  
**Next:** Phase 2.5 (Repos + Code Scanning) → Phase 3 (Scoring + Findings) → Phase 4 (Real-Time + Polish)  
**Note:** Initial Prisma migration has not been run yet.

## Dev Commands

```bash
# Start Postgres (required first)
make start                    # docker compose up -d + wait for healthy

# Platform API (port 3000)
cd platform-api && npm run dev          # tsx watch src/server.ts
cd platform-api && npm test             # vitest run
cd platform-api && npm run test:watch   # vitest (watch mode)
cd platform-api && npx prisma migrate dev   # run migrations
cd platform-api && npx prisma db seed       # seed test data

# Dashboard (port 5173)
cd dashboard && npm run dev             # vite dev server
cd dashboard && npm test                # vitest run

# Go Agent
cd sc-agent && go build -o bin/sc-agent ./cmd/sc-agent
cd sc-agent && go test -race ./...

# All at once
make dev                      # start infra + API + dashboard
make dev-stop                 # kill dev servers
make test                     # run all tests
make build                    # build all components
make stop                     # stop everything including docker
```

## Architecture

Three deployable components in a monorepo:

### platform-api (Node.js + TypeScript + Express 4)
- **Entry:** `src/server.ts` → `src/app.ts` (Express setup) + `src/scheduler.ts` (in-process cron)
- **Modules pattern:** Each domain in `src/modules/<name>/` with `*.router.ts`, `*.service.ts`, `*.validation.ts`, `index.ts`
- **Middleware stack** (order matters in `app.ts`): cors → json → cookie → requestId → requestLogger → rateLimit → routes → errorHandler
- **Auth:** JWT Bearer for browser, API key (`X-Agent-Key`) for Go agents. Middleware in `src/middleware/auth.ts` + `rbac.ts`
- **Validation:** Zod schemas in `*.validation.ts`, applied via `src/middleware/validate.ts`
- **Error handling:** `AppError` class with typed error codes in `src/middleware/errors.ts`. All responses wrapped in `successEnvelope()` / error envelope `{ data, meta, errors }`
- **Database:** PostgreSQL 16 via Prisma ORM. Schema at `prisma/schema.prisma`. Client singleton in `src/lib/prisma.ts`
- **Env config:** Zod-validated in `src/lib/env.ts` (dotenv loaded)
- **Scheduled tasks:** In-process `setInterval` in `src/scheduler.ts` (domain checks, offline detection). No Redis/BullMQ for MVP.

### dashboard (React 18 + TypeScript + Vite)
- MUI v7 for components, React Query v5 for data fetching, Recharts for charts, React Router v7
- API client with interceptors in `src/api/client.ts`
- Auth context + protected routes in `src/auth/`
- Pages organized by feature in `src/pages/`

### sc-agent (Go 1.22 + Cobra CLI)
- Single binary, designed for systemd deployment on customer servers
- **Adaptive heartbeat:** Collect metrics every 1s, send normal heartbeat every 60s, urgent heartbeat (15s debounce) on threshold breach (CPU >85%, RAM >85%, disk >90%)
- Entry: `cmd/sc-agent/main.go` → `internal/agent/` (heartbeat, collector, thresholds, scheduler, shutdown)
- System info: `internal/sysinfo/` (gopsutil)
- Platform client: `internal/platform/client.go`

### sc-scan (Go — not yet implemented)
- Code scanner binary to be ported from `archived/go/cmd/sc-scan/`
- Dependency SCA, secrets regex + entropy, unsafe config detection, risky pattern detection
- Invoked by platform-api in-process, outputs JSON findings

## Key Technical Decisions (differs from archived v1)

| Decision | Rationale |
|----------|-----------|
| PostgreSQL 16 | Better free cloud options (Neon, Supabase), native JSONB, no TiDB SSL quirks |
| No Redis/BullMQ for MVP | Async work runs in-process; add later for scaling |
| Express 4 (not 5) | Stable types, Express 5 types not yet mature |
| API key auth for agents (not mTLS) | Simpler onboarding |
| Delta code scanning | Scan changed files on feature branches, full scan on default branch pushes |
| GitHub App + GitLab PAT | Supports cloud + self-hosted (same pattern as archived) |

## Entity Model

Three asset types, each scored 0–100 (severity-based deduction):
- **Repository** — dependency vulnerabilities, secrets exposure, unsafe configs
- **Server** — OS patches, open ports, SSH config, firewall
- **Domain** — SSL certs, TLS config, DNS security (SPF/DKIM/DMARC), HTTP headers, uptime

Assets grouped under **Projects** within an **Organization** (multi-tenant).

## Adding a New API Module

1. Create `src/modules/<name>/` with router, service, validation, index files
2. Zod schemas in `*.validation.ts`, use `validate()` middleware in router
3. Use `AppError` for error responses, `successEnvelope()` for success
4. Register router in `src/app.ts`
5. Protect routes with `requireAuth` + `requirePermission()` middleware

## Infrastructure

- **PostgreSQL 16** on Docker: `localhost:5432`, credentials `securitycentral:securitycentral`
- DB connection string: `postgresql://securitycentral:securitycentral@localhost:5432/securitycentral`
