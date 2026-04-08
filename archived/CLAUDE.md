# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SecurityCentral is a unified security scanning and monitoring platform with four pillars:
1. **Code Security Scanner** (SCA, secrets, SAST) — replaces Snyk/Dependabot
2. **Infrastructure Scanner** (agent-based, SSH, cloud API) — replaces Tenable/Qualys
3. **Certificate & SSL Monitoring** (auto-discovery, expiration tracking, chain validation)
4. **CVE Correlation & Intelligence** (AI agents for correlation, prioritization, remediation, compliance)

Product idea: `init.md` | Technical spec: `SPEC.md` | Task backlog: `STORIES.md`

## Architecture

Five deployable units, monolith-first for MVP:

| Component | Language | Deployment | Directory |
|-----------|----------|------------|-----------|
| Platform API | Node.js + TypeScript (Express) | Container | `platform-api/` |
| Web Dashboard | React + TypeScript (Vite) | Static SPA | `dashboard/` |
| Code Scanner CLI | Go | Binary | `go/cmd/sc-scan/` |
| Infra Agent | Go | Binary (systemd) | `go/cmd/sc-agent/` |
| Cert Monitor | Go | Container (CronJob) | `go/cmd/sc-certmon/` |

Key design decisions:
- Platform API is a modular monolith (module boundaries designed for future extraction)
- Prisma ORM for PostgreSQL; Elasticsearch is a read replica for finding search/aggregation
- BullMQ (Redis) for all async work: scan dispatch, notifications, PR creation, ES sync
- Go components share `go/internal/` and `go/pkg/models/` for platform communication (mTLS), vuln DB, scanning logic
- WebSocket updates via Socket.IO

## Tech Stack

- **Platform backend:** Node.js + TypeScript, Express, Prisma, BullMQ
- **Frontend:** React 18 + TypeScript, Vite
- **Scanning engines & agent:** Go (single binary, cross-compile)
- **Database:** PostgreSQL 16+
- **Cache/Queue:** Redis 7+ / BullMQ
- **Search:** Elasticsearch 8.x (OpenSearch for local dev)
- **Real-time:** Socket.IO (WebSocket)
- **Agent communication:** HTTPS + mTLS

## Build & Dev Commands

Once scaffolded (see Story 1.1 in STORIES.md), the planned commands are:

```bash
# Local infrastructure
docker compose up          # PostgreSQL, Redis, OpenSearch with health checks

# Development
make dev                   # Start all services in dev mode
make test                  # Run all tests
make lint                  # Lint all components
make build                 # Build all components
make migrate               # Run Prisma migrations (platform-api)

# Platform API (Node.js)
cd platform-api && npm run dev    # Dev server
cd platform-api && npm test       # Tests
npx prisma migrate dev            # Schema migrations
npx prisma db seed                # Seed test data

# Go components
cd go && go build ./cmd/sc-scan/     # Code scanner
cd go && go build ./cmd/sc-agent/    # Infra agent
cd go && go build ./cmd/sc-certmon/  # Cert monitor
cd go && go test ./...               # All Go tests

# Dashboard (React)
cd dashboard && npm run dev    # Vite dev server
cd dashboard && npm test       # Tests
```

## Task Tracking

All MVP work is tracked in `STORIES.md` organized as Epic → Story → Task:
- Tasks are prefixed `T-X.Y.Z` (e.g., `T-1.1.1`)
- Dependencies noted as `depends: T-X.Y.Z`
- Sizes: S (hours), M (1-2 days), L (3-5 days), XL (1-2 weeks)
- Mark tasks `[x]` when complete

Use the `/implement-task` skill to pick up a task: it rewrites it in proper user story format, generates Given/When/Then acceptance criteria, implements the code, and updates STORIES.md.

## MVP Scope (Phase 1)

In scope:
- Dependency scanning (npm, pip, Maven) + secrets detection
- GitHub/GitLab integration + auto-create PRs
- Agent-based infra scanning (Ubuntu, CentOS, Alpine) + AWS EC2 discovery
- Certificate auto-discovery (ALB/NLB) + expiration alerts
- Dashboard with drill-down, Slack notifications, CVSS-based prioritization, REST API

Deferred: SAST, container/IaC scanning, SSH-based scanning, GCP/Azure, AI agents, compliance reporting, team management.
