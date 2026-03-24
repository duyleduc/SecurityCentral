# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SecurityCentral is a unified security scanning and monitoring platform with four pillars:
1. **Code Security Scanner** (SCA, secrets, SAST) — replaces Snyk/Dependabot
2. **Infrastructure Scanner** (agent-based, SSH, cloud API) — replaces Tenable/Qualys
3. **Certificate & SSL Monitoring** (auto-discovery, expiration tracking, chain validation)
4. **CVE Correlation & Intelligence** (AI agents for correlation, prioritization, remediation, compliance)

Product idea: `init.md` | Technical spec: `SecurityCentral/SPEC.md`

## Architecture

```
Central Platform (Web dashboard + API + AI orchestration)
    ├── Code Scan Engine (Go binary, CLI + CI/CD plugins)
    ├── Infra Scan Engine (Go agent <2MB, or SSH/cloud API)
    └── Cert Monitor Engine (background service / K8s CronJob)
         ↓
Unified Findings DB (PostgreSQL, normalized CVE format)
         ↓
AI Agent Layer (Correlation → Prioritization → Remediation → Reporting)
         ↓
User Interfaces (Dashboard, Slack, CLI, API, Email)
```

## Tech Stack (from spec)

- **Scanning engines & agent:** Go (compiled binary, cross-platform)
- **Central platform backend:** Node.js or Python
- **Database:** PostgreSQL (audit trail, compliance data)
- **Cache:** Redis (real-time dashboards)
- **Search:** Elasticsearch (filter findings at scale)
- **Real-time:** WebSockets or SSE for live dashboard updates
- **Job queue:** Async scanning, report generation, integrations
- **Agent communication:** HTTPS + mTLS

## MVP Scope (Phase 1)

What's in scope for initial build:
- Dependency scanning (npm, pip, Maven) + secrets detection
- GitHub/GitLab integration + auto-create PRs
- Agent-based infra scanning (Ubuntu, CentOS, Alpine) + AWS EC2 discovery
- Certificate auto-discovery (ALB/NLB) + expiration alerts
- Dashboard with drill-down, Slack notifications, CVSS-based prioritization, REST API

What's explicitly deferred: SAST, container/IaC scanning, SSH-based scanning, GCP/Azure, AI agents, compliance reporting, team management.
