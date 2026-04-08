# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SecurityCentral is a lightweight infrastructure security and monitoring platform for small companies. It provides a unified view of code repositories (security scanning), servers (health + security posture), and domains (SSL/TLS, DNS, uptime). Designed for non-security teams — emphasis on clarity, low setup friction, and actionable alerts.

Product spec: `docs/securitycentral-spec.md`

## Current State

The project is being rebuilt from scratch. Previous implementation is preserved in `archived/` for reference only — do not modify files there. New code goes in the project root.

### Archived Reference (`archived/`)

The previous implementation used this architecture (reference only):

| Component | Stack | Directory |
|-----------|-------|-----------|
| Platform API | Node.js, TypeScript, Express, Prisma, BullMQ | `archived/platform-api/` |
| Dashboard | React 18, TypeScript, Vite, MUI, React Query | `archived/dashboard/` |
| Code Scanner | Go, Cobra CLI | `archived/go/cmd/sc-scan/` |
| Infra Agent | Go (systemd binary) | `archived/go/cmd/sc-agent/` |
| Cert Monitor | Go (CronJob) | `archived/go/cmd/sc-certmon/` |

Key decisions from v1 worth preserving:
- Monolith-first, modular boundaries for future extraction
- PostgreSQL + Prisma ORM, Redis + BullMQ for async jobs
- Go single-binary scanners/agents with shared `internal/` packages
- Socket.IO for real-time updates, mTLS for agent communication
- Ed25519 binary signing for agent verification

### Infrastructure (from archived docker-compose)

| Service | Port |
|---------|------|
| PostgreSQL 16 | 5432 |
| Redis 7 | 6379 |
| OpenSearch 2.12 | 9200 |
| Platform API | 3000 |
| Dashboard (Vite) | 5173 |

DB credentials: `securitycentral:securitycentral@localhost:5432/securitycentral`

## Entity Model

Three asset types, each with a Security Score (0–100):
- **Repository** — dependency vulnerabilities, secrets exposure, unsafe configs
- **Server** — OS patches, open ports, SSH config, firewall, user access
- **Domain** — SSL certs, TLS config, DNS security (SPF/DKIM/DMARC), HTTP headers, uptime

Assets are grouped under **Projects**. Scoring is explainable ("why" behind each score).

## MVP Scope

In: dependency scanning, secrets detection, server metrics + thresholds, domain SSL + uptime, basic scoring, dashboard with drill-down.

Deferred: SAST, container/IaC scanning, compliance reports, automated remediation, team roles.
