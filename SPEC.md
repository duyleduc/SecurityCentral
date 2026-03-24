# SecurityCentral — Technical Specification

**Version:** 1.0.0
**Status:** Draft
**Source:** `init.md` (Product Specification)
**Scope:** MVP (Phase 1) with extension points for Phase 2/3

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Service Architecture](#2-service-architecture)
3. [Data Models](#3-data-models)
4. [API Specification](#4-api-specification)
5. [Code Scanning Engine](#5-code-scanning-engine)
6. [Infrastructure Scanning Agent](#6-infrastructure-scanning-agent)
7. [Certificate Monitoring Engine](#7-certificate-monitoring-engine)
8. [Agent Communication Protocol](#8-agent-communication-protocol)
9. [Vulnerability Database](#9-vulnerability-database)
10. [Notification System](#10-notification-system)
11. [Authentication & Authorization](#11-authentication--authorization)
12. [Deployment Architecture](#12-deployment-architecture)
13. [Non-Functional Requirements](#13-non-functional-requirements)
14. [Observability](#14-observability)
15. [Phase 2/3 Extension Points](#15-phase-23-extension-points)

---

## 1. System Overview

### 1.1 Scope

SecurityCentral is composed of five deployable units:

| Component | Language | Deployment | Role |
|-----------|----------|------------|------|
| **Platform API** | Node.js (TypeScript) | Container (ECS/K8s) | REST API, WebSocket server, job orchestration |
| **Web Dashboard** | React + TypeScript | Static (S3/CDN) | SPA frontend |
| **Code Scanner CLI** | Go | Binary distribution | Dependency + secrets scanning |
| **Infra Agent** | Go | Binary (systemd) | On-host vulnerability scanning |
| **Cert Monitor** | Go | Container (CronJob) | Certificate discovery + monitoring |

### 1.2 High-Level Data Flow

```
                          ┌────────────────────┐
                          │   Web Dashboard    │
                          │   (React SPA)      │
                          └────────┬───────────┘
                                   │ HTTPS
                          ┌────────▼───────────┐
                          │   Platform API     │
                          │   (Node.js)        │
                          │                    │
                          │  ┌──────────────┐  │
         ┌───────────────►│  │ Job Queue    │  │◄──────────────────┐
         │    mTLS        │  │ (BullMQ/     │  │   mTLS            │
         │                │  │  Redis)      │  │                   │
         │                │  └──────────────┘  │                   │
         │                └────────┬───────────┘                   │
         │                         │                               │
    ┌────┴─────┐          ┌────────▼───────────┐          ┌───────┴──────┐
    │  Code    │          │   PostgreSQL       │          │  Cert        │
    │  Scanner │          │   + Elasticsearch  │          │  Monitor     │
    │  CLI     │          │   + Redis          │          │  (CronJob)   │
    └──────────┘          └────────────────────┘          └──────────────┘
                                                                 │
    ┌──────────┐                                                 │
    │  Infra   │─────── mTLS ────────────────────────────────────┘
    │  Agent   │         (reports to Platform API)
    └──────────┘
```

### 1.3 Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Platform language | TypeScript (Node.js) | Fast iteration, strong typing, large ecosystem for integrations |
| Scanner language | Go | Single binary, cross-compile, low resource footprint |
| Primary DB | PostgreSQL 16+ | JSONB for flexible finding metadata, strong audit trail, row-level security |
| Search | Elasticsearch 8.x | Full-text search over findings, aggregation for dashboard widgets |
| Cache + Queue | Redis 7+ / BullMQ | Job queue (scan orchestration), caching (dashboard), pub/sub (WebSocket fan-out) |
| Real-time | WebSocket (Socket.IO) | Live dashboard updates when new findings arrive |
| Frontend | React 18 + TypeScript | Component ecosystem, strong typing |
| IaC | Terraform | AWS infrastructure provisioning |
| CI/CD | GitHub Actions | Matches target customer integration |

---

## 2. Service Architecture

### 2.1 Platform API (Node.js)

Monolithic API server (modular internals, not microservices for MVP) with the following internal modules:

```
platform-api/
├── src/
│   ├── modules/
│   │   ├── auth/           # JWT issuance, API key management, org/user RBAC
│   │   ├── findings/       # CRUD + search for vulnerability findings
│   │   ├── assets/         # Repositories, servers, certificates, environments
│   │   ├── scans/          # Scan job lifecycle (trigger, status, results)
│   │   ├── integrations/   # GitHub/GitLab webhooks, Slack notifications
│   │   ├── agents/         # Agent registration, heartbeat, command dispatch
│   │   └── dashboard/      # Aggregation queries, widget data
│   ├── jobs/               # BullMQ job processors
│   │   ├── scan-orchestrator.ts
│   │   ├── finding-ingester.ts
│   │   ├── notification-dispatcher.ts
│   │   ├── vuln-db-sync.ts
│   │   └── github-pr-creator.ts
│   ├── ws/                 # WebSocket handlers (Socket.IO)
│   ├── middleware/         # Auth, rate limiting, request validation
│   └── lib/               # Shared utilities, DB client, ES client
├── prisma/
│   └── schema.prisma       # Database schema
├── tests/
└── package.json
```

**Key design decisions:**
- Monolith for MVP speed; module boundaries designed for future extraction
- BullMQ for all async work (scan dispatch, notification, PR creation)
- Prisma ORM for PostgreSQL (type-safe queries, migrations)
- Elasticsearch for finding search/aggregation (PostgreSQL is source of truth, ES is read replica)

### 2.2 Web Dashboard (React)

```
dashboard/
├── src/
│   ├── pages/
│   │   ├── DashboardOverview/    # Summary widgets, severity breakdown, trends
│   │   ├── Findings/             # Filterable findings list + detail view
│   │   ├── Assets/               # Repos, servers, certs inventory
│   │   ├── Scans/                # Scan history, trigger manual scans
│   │   ├── Integrations/         # Configure GitHub/GitLab/Slack connections
│   │   └── Settings/             # Org settings, API keys, notification preferences
│   ├── components/
│   ├── hooks/
│   ├── api/                      # API client (generated from OpenAPI spec)
│   └── ws/                       # WebSocket client for live updates
└── package.json
```

### 2.3 Go Components (shared module structure)

All three Go components (Code Scanner, Infra Agent, Cert Monitor) share a common module for platform communication:

```
go/
├── cmd/
│   ├── sc-scan/          # Code Scanner CLI entrypoint
│   ├── sc-agent/         # Infrastructure Agent entrypoint
│   └── sc-certmon/       # Certificate Monitor entrypoint
├── internal/
│   ├── platform/         # mTLS client, finding submission, heartbeat
│   ├── vulndb/           # Local vulnerability DB reader (BoltDB)
│   ├── scanner/
│   │   ├── deps/         # Dependency scanning (lockfile parsers)
│   │   ├── secrets/      # Secret pattern matching
│   │   └── packages/     # OS package enumeration
│   ├── certdiscovery/    # TLS connection, cert extraction, chain validation
│   └── config/           # Configuration loading (env, flags, file)
├── pkg/
│   └── models/           # Shared types (Finding, Asset, ScanResult)
├── go.mod
└── go.sum
```

---

## 3. Data Models

### 3.1 PostgreSQL Schema

#### Organizations & Users

```sql
CREATE TABLE organizations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL UNIQUE,
    plan            TEXT NOT NULL DEFAULT 'starter',  -- starter | growth | enterprise
    settings        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id),
    email           TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'member',   -- owner | admin | member | viewer
    password_hash   TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE api_keys (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id),
    created_by      UUID NOT NULL REFERENCES users(id),
    name            TEXT NOT NULL,
    key_hash        TEXT NOT NULL UNIQUE,             -- SHA-256 of the key; raw key shown once
    key_prefix      TEXT NOT NULL,                    -- first 8 chars for identification
    scopes          TEXT[] NOT NULL DEFAULT '{}',     -- scan:write, findings:read, etc.
    last_used_at    TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### Assets

```sql
CREATE TABLE repositories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id),
    provider        TEXT NOT NULL,                    -- github | gitlab | bitbucket
    provider_id     TEXT NOT NULL,                    -- external ID from provider
    owner           TEXT NOT NULL,                    -- repo owner/org
    name            TEXT NOT NULL,
    default_branch  TEXT NOT NULL DEFAULT 'main',
    language        TEXT,                             -- primary language
    last_scan_at    TIMESTAMPTZ,
    settings        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(org_id, provider, provider_id)
);

CREATE TABLE servers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id),
    agent_id        TEXT UNIQUE,                      -- assigned on agent registration
    hostname        TEXT NOT NULL,
    os_family       TEXT NOT NULL,                    -- ubuntu | centos | alpine | rhel | debian
    os_version      TEXT NOT NULL,
    arch            TEXT NOT NULL DEFAULT 'amd64',    -- amd64 | arm64
    cloud_provider  TEXT,                             -- aws | gcp | azure | null (on-prem)
    cloud_region    TEXT,
    cloud_instance_id TEXT,
    environment     TEXT NOT NULL DEFAULT 'production', -- production | staging | development
    agent_version   TEXT,
    last_heartbeat  TIMESTAMPTZ,
    last_scan_at    TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'active',   -- active | inactive | decommissioned
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE certificates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id),
    subject_cn      TEXT NOT NULL,                    -- Common Name
    sans            TEXT[] NOT NULL DEFAULT '{}',     -- Subject Alternative Names
    issuer_cn       TEXT NOT NULL,
    serial_number   TEXT NOT NULL,
    fingerprint_sha256 TEXT NOT NULL,
    not_before      TIMESTAMPTZ NOT NULL,
    not_after       TIMESTAMPTZ NOT NULL,
    key_algorithm   TEXT NOT NULL,                    -- RSA-2048 | RSA-4096 | ECDSA-P256 | etc.
    signature_algorithm TEXT NOT NULL,
    chain_valid     BOOLEAN,
    chain_depth     INT,
    discovered_from TEXT NOT NULL,                    -- alb:arn:... | nginx:/etc/... | port:443
    source_asset_id UUID,                            -- FK to servers.id if applicable
    last_checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status          TEXT NOT NULL DEFAULT 'active',   -- active | expiring | expired | revoked
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(org_id, fingerprint_sha256)
);
```

#### Findings (Core)

```sql
CREATE TYPE finding_source AS ENUM ('code_scanner', 'infra_agent', 'cert_monitor');
CREATE TYPE severity_level AS ENUM ('critical', 'high', 'medium', 'low', 'info');
CREATE TYPE finding_status AS ENUM ('open', 'in_progress', 'resolved', 'suppressed', 'false_positive');

CREATE TABLE findings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id),
    source          finding_source NOT NULL,
    severity        severity_level NOT NULL,
    status          finding_status NOT NULL DEFAULT 'open',
    title           TEXT NOT NULL,
    description     TEXT,

    -- CVE correlation
    cve_id          TEXT,                            -- CVE-2024-XXXX or null
    cvss_score      DECIMAL(3,1),                    -- 0.0 – 10.0
    cvss_vector     TEXT,                            -- CVSS:3.1/AV:N/AC:L/...

    -- Asset linkage (exactly one should be non-null)
    repository_id   UUID REFERENCES repositories(id),
    server_id       UUID REFERENCES servers(id),
    certificate_id  UUID REFERENCES certificates(id),

    -- Source-specific detail
    detail          JSONB NOT NULL DEFAULT '{}',
    /*
     detail structure varies by source:
     code_scanner:  { "package_name", "installed_version", "fixed_version",
                      "lockfile_path", "secret_type", "file_path", "line_number" }
     infra_agent:   { "package_name", "installed_version", "fixed_version",
                      "os_family", "cis_benchmark_id", "config_file" }
     cert_monitor:  { "days_until_expiry", "weak_algorithm", "chain_issue",
                      "cipher_suite" }
    */

    -- Remediation
    remediation     TEXT,                            -- human-readable fix guidance
    auto_fixable    BOOLEAN NOT NULL DEFAULT false,
    fix_pr_url      TEXT,                            -- URL to auto-created PR

    -- Scan linkage
    scan_id         UUID NOT NULL REFERENCES scans(id),
    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at     TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_findings_org_status ON findings(org_id, status);
CREATE INDEX idx_findings_org_severity ON findings(org_id, severity);
CREATE INDEX idx_findings_cve ON findings(cve_id) WHERE cve_id IS NOT NULL;
CREATE INDEX idx_findings_repo ON findings(repository_id) WHERE repository_id IS NOT NULL;
CREATE INDEX idx_findings_server ON findings(server_id) WHERE server_id IS NOT NULL;
CREATE INDEX idx_findings_cert ON findings(certificate_id) WHERE certificate_id IS NOT NULL;
```

#### Scans

```sql
CREATE TYPE scan_type AS ENUM ('code_dependencies', 'code_secrets', 'infra_packages', 'infra_compliance', 'cert_discovery', 'cert_check');
CREATE TYPE scan_status AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled');

CREATE TABLE scans (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id),
    scan_type       scan_type NOT NULL,
    status          scan_status NOT NULL DEFAULT 'pending',
    trigger         TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | manual | webhook | agent
    -- Asset being scanned (one non-null)
    repository_id   UUID REFERENCES repositories(id),
    server_id       UUID REFERENCES servers(id),
    -- Results summary (filled on completion)
    findings_total  INT DEFAULT 0,
    findings_new    INT DEFAULT 0,
    findings_resolved INT DEFAULT 0,
    error_message   TEXT,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    duration_ms     INT,
    metadata        JSONB NOT NULL DEFAULT '{}',     -- scanner version, commit SHA, etc.
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### Integrations

```sql
CREATE TABLE integrations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id),
    provider        TEXT NOT NULL,                    -- github | gitlab | slack
    status          TEXT NOT NULL DEFAULT 'active',
    config          JSONB NOT NULL DEFAULT '{}',      -- encrypted at rest
    /*
     github:  { "installation_id", "app_id" }
     gitlab:  { "access_token_enc", "webhook_secret_enc" }
     slack:   { "webhook_url_enc", "channel" }
    */
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(org_id, provider)
);
```

### 3.2 Elasticsearch Index Mapping

Findings are synced from PostgreSQL to Elasticsearch for search/aggregation:

```json
{
  "mappings": {
    "properties": {
      "id":             { "type": "keyword" },
      "org_id":         { "type": "keyword" },
      "source":         { "type": "keyword" },
      "severity":       { "type": "keyword" },
      "status":         { "type": "keyword" },
      "title":          { "type": "text", "fields": { "keyword": { "type": "keyword" } } },
      "description":    { "type": "text" },
      "cve_id":         { "type": "keyword" },
      "cvss_score":     { "type": "float" },
      "repository_id":  { "type": "keyword" },
      "server_id":      { "type": "keyword" },
      "certificate_id": { "type": "keyword" },
      "detail":         { "type": "object", "enabled": true },
      "auto_fixable":   { "type": "boolean" },
      "first_seen_at":  { "type": "date" },
      "resolved_at":    { "type": "date" },
      "created_at":     { "type": "date" }
    }
  }
}
```

Sync strategy: On every finding INSERT/UPDATE in PostgreSQL, enqueue a BullMQ job that upserts the document into Elasticsearch by `id`.

---

## 4. API Specification

Base URL: `https://api.securitycentral.io/v1`

Authentication: `Authorization: Bearer <JWT>` or `X-API-Key: sc_live_...`

All responses follow envelope format:

```json
{
  "data": { ... },
  "meta": { "page": 1, "per_page": 50, "total": 1234 },
  "errors": []
}
```

### 4.1 Authentication

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/register` | Create organization + first user |
| POST | `/auth/login` | Email/password → JWT (access + refresh) |
| POST | `/auth/refresh` | Refresh token → new access token |
| POST | `/auth/api-keys` | Create API key (returns raw key once) |
| GET | `/auth/api-keys` | List API keys for org |
| DELETE | `/auth/api-keys/:id` | Revoke API key |

**JWT payload:**
```json
{
  "sub": "<user_id>",
  "org": "<org_id>",
  "role": "admin",
  "iat": 1711234567,
  "exp": 1711238167
}
```

Access token TTL: 1 hour. Refresh token TTL: 30 days (stored in HttpOnly cookie).

### 4.2 Findings

| Method | Path | Description |
|--------|------|-------------|
| GET | `/findings` | List findings (filterable, paginated) |
| GET | `/findings/:id` | Get finding detail |
| PATCH | `/findings/:id` | Update status (resolve, suppress, false_positive) |
| GET | `/findings/stats` | Aggregated counts by severity, source, status |
| GET | `/findings/trends` | Time-series: new/resolved findings over time |

**GET `/findings` query parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `severity` | string[] | Filter by severity: `critical,high` |
| `status` | string[] | Filter by status: `open,in_progress` |
| `source` | string[] | Filter by source: `code_scanner,infra_agent` |
| `cve_id` | string | Exact CVE ID match |
| `repository_id` | uuid | Filter by repository |
| `server_id` | uuid | Filter by server |
| `certificate_id` | uuid | Filter by certificate |
| `q` | string | Full-text search (title, description, CVE) |
| `sort` | string | `severity`, `cvss_score`, `first_seen_at`, `created_at` |
| `order` | string | `asc` or `desc` |
| `page` | int | Page number (default 1) |
| `per_page` | int | Items per page (default 50, max 200) |

### 4.3 Assets

#### Repositories

| Method | Path | Description |
|--------|------|-------------|
| GET | `/repositories` | List repositories |
| POST | `/repositories` | Register repository (or auto-discover from GitHub integration) |
| GET | `/repositories/:id` | Repository detail + latest scan summary |
| DELETE | `/repositories/:id` | Remove repository |
| POST | `/repositories/:id/scan` | Trigger manual scan |

#### Servers

| Method | Path | Description |
|--------|------|-------------|
| GET | `/servers` | List servers |
| GET | `/servers/:id` | Server detail + installed packages + findings |
| DELETE | `/servers/:id` | Decommission server |

#### Certificates

| Method | Path | Description |
|--------|------|-------------|
| GET | `/certificates` | List certificates |
| GET | `/certificates/:id` | Certificate detail + chain info |
| GET | `/certificates/expiring` | Certificates expiring within N days |

### 4.4 Scans

| Method | Path | Description |
|--------|------|-------------|
| GET | `/scans` | List scans (filterable by type, status, asset) |
| GET | `/scans/:id` | Scan detail + findings summary |
| POST | `/scans/:id/cancel` | Cancel a running scan |

### 4.5 Integrations

| Method | Path | Description |
|--------|------|-------------|
| GET | `/integrations` | List configured integrations |
| POST | `/integrations/github` | Install GitHub App (initiate OAuth flow) |
| POST | `/integrations/gitlab` | Connect GitLab (access token) |
| POST | `/integrations/slack` | Configure Slack webhook |
| DELETE | `/integrations/:id` | Remove integration |
| POST | `/integrations/github/webhook` | GitHub webhook receiver (events: push, PR, installation) |
| POST | `/integrations/gitlab/webhook` | GitLab webhook receiver |

### 4.6 Agents (Internal API — mTLS only)

Used by the Infra Agent and Code Scanner to report results:

| Method | Path | Description |
|--------|------|-------------|
| POST | `/agents/register` | Register new agent → returns agent_id + mTLS cert |
| POST | `/agents/heartbeat` | Agent heartbeat (includes system metadata) |
| POST | `/agents/findings` | Submit scan findings (batch) |
| GET | `/agents/vulndb/version` | Check latest vulnerability DB version |
| GET | `/agents/vulndb/download` | Download vulnerability DB delta |
| GET | `/agents/version` | Check for agent binary updates |

### 4.7 Dashboard

| Method | Path | Description |
|--------|------|-------------|
| GET | `/dashboard/summary` | Org-wide summary (counts, severity breakdown) |
| GET | `/dashboard/top-risks` | Top 10 highest-risk findings |
| GET | `/dashboard/assets-overview` | Asset counts + health status |

### 4.8 WebSocket Events

Connection: `wss://api.securitycentral.io/ws` (authenticated via JWT in handshake)

**Server → Client events:**

| Event | Payload | Trigger |
|-------|---------|---------|
| `finding:new` | `{ finding_id, severity, title, source }` | New finding ingested |
| `finding:resolved` | `{ finding_id }` | Finding auto-resolved |
| `scan:started` | `{ scan_id, scan_type, asset }` | Scan begins |
| `scan:completed` | `{ scan_id, findings_total, findings_new }` | Scan completes |
| `agent:connected` | `{ server_id, hostname }` | Agent comes online |
| `agent:disconnected` | `{ server_id, hostname }` | Agent heartbeat missed |
| `cert:expiring` | `{ certificate_id, subject_cn, days_until_expiry }` | Cert crosses alert threshold |

---

## 5. Code Scanning Engine

### 5.1 CLI Interface

```
sc-scan [flags]

Flags:
  --path <dir>          Path to repository root (default: ".")
  --api-key <key>       SecurityCentral API key (or SC_API_KEY env var)
  --api-url <url>       Platform API URL (default: https://api.securitycentral.io)
  --scan-deps           Enable dependency scanning (default: true)
  --scan-secrets        Enable secrets scanning (default: true)
  --output <format>     Output format: json | sarif | table (default: table)
  --output-file <path>  Write results to file instead of stdout
  --fail-on <severity>  Exit non-zero if findings at or above severity (for CI)
  --incremental         Only scan changed files (requires git)
  --no-upload           Do not upload results to platform (local-only mode)
  --verbose             Verbose logging
```

**Exit codes:**
- `0`: Scan completed, no findings above threshold
- `1`: Scan completed, findings above `--fail-on` threshold
- `2`: Scan error (config, network, parse failure)

### 5.2 Dependency Scanning

**Supported lockfiles (MVP):**

| Ecosystem | Lockfile | Parser |
|-----------|----------|--------|
| npm | `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml` | Parse JSON/YAML, extract package@version tuples |
| pip | `requirements.txt`, `Pipfile.lock`, `poetry.lock` | Parse pinned versions |
| Maven | `pom.xml` (resolved), `gradle.lockfile` | Parse XML/lockfile for groupId:artifactId:version |

**Algorithm:**

1. Walk the repository, discover lockfiles by filename pattern
2. Parse each lockfile → extract list of `(ecosystem, package_name, version)` tuples
3. For each tuple, query local vulnerability DB (BoltDB): lookup by `(ecosystem, package_name)` → list of affected version ranges
4. Check if `version` falls within any affected range (semver comparison)
5. For each match, produce a `Finding` with:
   - CVE ID, CVSS score, severity
   - Installed version, fixed version (if available)
   - Lockfile path, dependency path (direct vs. transitive)
   - Remediation text + whether auto-fixable

**Auto-fix PR generation:**

When integrated with GitHub/GitLab:
1. For each fixable finding, compute the minimum version bump
2. Create a branch `securitycentral/fix-<cve_id>-<timestamp>`
3. Update the lockfile(s) with the fixed version
4. Open PR with title: `fix(security): upgrade <package> to <version> (CVE-XXXX-YYYY)`
5. PR body includes: severity, CVE details, changelog link, what changed
6. Record `fix_pr_url` on the finding

### 5.3 Secrets Detection

**Detection method:** Regex pattern matching + entropy analysis

**Pattern categories (MVP — 50 core patterns, expandable):**

| Category | Examples |
|----------|----------|
| Cloud provider keys | `AKIA[0-9A-Z]{16}` (AWS), `AIza[0-9A-Za-z_-]{35}` (GCP) |
| API tokens | GitHub PAT, Slack token, Stripe key, Twilio, SendGrid |
| Private keys | PEM-encoded RSA/EC private keys |
| Database URIs | `postgres://`, `mysql://`, `mongodb://` with credentials |
| Generic secrets | High-entropy strings near keywords (`password`, `secret`, `token`, `api_key`) |

**Entropy filter:** For generic patterns, compute Shannon entropy of candidate string. Only flag if entropy > 4.5 (reduces false positives on placeholder values).

**Exclusions:**
- Files matching `.gitignore` patterns
- Known test fixtures (`*_test.*`, `testdata/`, `fixtures/`)
- Lockfiles and auto-generated files
- User-configurable allowlist via `.securitycentral.yml`:

```yaml
secrets:
  allow:
    - path: "docs/examples/**"
    - pattern: "EXAMPLE_.*"
    - hash: "sha256:abc123..."   # allow specific known-safe string
```

### 5.4 Configuration File

`.securitycentral.yml` in repository root:

```yaml
version: 1

scan:
  dependencies: true
  secrets: true

dependencies:
  ignore:
    - cve: "CVE-2023-XXXXX"       # suppress specific CVE
      reason: "Not reachable in our code"
      expires: "2025-06-01"
    - package: "lodash"
      below: "4.17.21"            # ignore below this version

secrets:
  allow:
    - path: "test/**"
    - pattern: "DUMMY_.*"

fail_on: high                       # CI gate: fail on high or critical

notifications:
  slack: true
  pr_comments: true
```

---

## 6. Infrastructure Scanning Agent

### 6.1 Agent Lifecycle

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│ Install  │────►│ Register │────►│ Running  │────►│ Scanning │
│          │     │ (mTLS)   │     │ (heartbeat│     │ (every   │
│          │     │          │     │  loop)   │     │  6 hours)│
└──────────┘     └──────────┘     └──────────┘     └──────────┘
                                       │                  │
                                       ▼                  ▼
                                  ┌──────────┐     ┌──────────┐
                                  │ Self-    │     │ Upload   │
                                  │ Update   │     │ Results  │
                                  └──────────┘     └──────────┘
```

### 6.2 Installation

```bash
curl -fsSL https://get.securitycentral.io/agent | bash -s -- \
  --api-key sc_live_xxxx \
  --api-url https://api.securitycentral.io \
  --environment production \
  --labels "team=backend,service=api"
```

The installer:
1. Downloads the platform-appropriate binary (`linux/amd64`, `linux/arm64`)
2. Verifies binary signature (ed25519)
3. Creates `/etc/securitycentral/agent.yml` config
4. Registers with platform → receives `agent_id` and mTLS client certificate
5. Installs systemd unit `securitycentral-agent.service`
6. Starts the agent

### 6.3 Agent Configuration

`/etc/securitycentral/agent.yml`:

```yaml
agent_id: "ag_xxxxxxxxxxxxxxxx"
api_url: "https://api.securitycentral.io"
environment: "production"
labels:
  team: "backend"
  service: "api"

scan:
  interval: "6h"              # scan interval
  on_startup: true            # run scan immediately on start

tls:
  cert: "/etc/securitycentral/agent.crt"
  key: "/etc/securitycentral/agent.key"
  ca: "/etc/securitycentral/ca.crt"

vulndb:
  path: "/var/lib/securitycentral/vulndb.bolt"
  auto_update: true

log:
  level: "info"               # debug | info | warn | error
  file: "/var/log/securitycentral/agent.log"
```

### 6.4 Heartbeat Protocol

Every **60 seconds**, the agent sends:

```json
POST /v1/agents/heartbeat
{
  "agent_id": "ag_xxxx",
  "timestamp": "2025-03-24T10:00:00Z",
  "uptime_seconds": 86400,
  "agent_version": "0.1.0",
  "os": {
    "family": "ubuntu",
    "version": "22.04",
    "kernel": "5.15.0-91-generic",
    "arch": "amd64"
  },
  "resources": {
    "cpu_percent": 0.3,
    "memory_mb": 8,
    "disk_percent": 45.2
  },
  "vulndb_version": "2025-03-24T00:00:00Z",
  "last_scan_at": "2025-03-24T06:00:00Z"
}
```

**Platform response** can include commands:

```json
{
  "commands": [
    { "type": "scan_now" },
    { "type": "update_agent", "version": "0.2.0", "url": "https://..." },
    { "type": "update_vulndb" }
  ]
}
```

### 6.5 Package Scanning

**OS package enumeration by family:**

| OS Family | Command/Source | Parse Format |
|-----------|---------------|-------------|
| Ubuntu/Debian | `dpkg-query -W -f '${Package}\t${Version}\t${Architecture}\n'` | Tab-separated |
| CentOS/RHEL | `rpm -qa --queryformat '%{NAME}\t%{VERSION}-%{RELEASE}\t%{ARCH}\n'` | Tab-separated |
| Alpine | `/lib/apk/db/installed` | APK DB file parsing |

**Algorithm:**

1. Enumerate installed packages → `(name, version, arch)` list
2. Read `/etc/os-release` → determine OS family + version
3. Query local vuln DB: for each `(os_family, os_version, package_name)` → affected version ranges
4. Compare installed version against affected ranges
5. Generate findings

### 6.6 CIS Benchmark Scanning (Ubuntu L1 — MVP)

Implement checks as individual Go functions conforming to a `Check` interface:

```go
type Check interface {
    ID() string                    // "1.1.1.1"
    Title() string                 // "Ensure mounting of cramfs filesystems is disabled"
    Level() int                    // 1 or 2
    Run(ctx context.Context) (CheckResult, error)
}

type CheckResult struct {
    Pass    bool
    Details string                 // what was found
    Fix     string                 // remediation command
}
```

MVP covers CIS Ubuntu 22.04 Level 1 (~80 checks) in categories:
- Filesystem configuration
- Software updates configuration
- Filesystem integrity checking
- Secure boot settings
- Process hardening
- Network configuration (host-only)
- SSH server configuration
- User/group settings

Each check reads system files or executes read-only commands. **No check modifies the system.**

### 6.7 Resource Constraints

| Resource | Limit | Enforcement |
|----------|-------|-------------|
| CPU | <1% average, 5% burst during scan | `GOMAXPROCS(1)` + `nice 19` |
| Memory | <10MB resident | Pre-allocated buffers, streaming parsers |
| Disk | <50MB (binary + vuln DB + logs) | Log rotation (5MB × 3 files) |
| Network | <1MB/heartbeat, <10MB/scan upload | Gzip compression, delta vuln DB updates |
| Binary size | <5MB | Strip symbols, UPX optional |

---

## 7. Certificate Monitoring Engine

### 7.1 Deployment

Runs as a Kubernetes CronJob (every 1 hour) or standalone binary with built-in scheduler.

```yaml
# Kubernetes CronJob
apiVersion: batch/v1
kind: CronJob
metadata:
  name: sc-certmon
spec:
  schedule: "0 * * * *"       # every hour
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: certmon
            image: securitycentral/certmon:latest
            env:
            - name: SC_API_KEY
              valueFrom:
                secretKeyRef:
                  name: sc-credentials
                  key: api-key
```

### 7.2 Discovery Methods (MVP)

#### AWS ALB/NLB Certificate Discovery

```
1. List all ALBs/NLBs via AWS SDK (elbv2:DescribeLoadBalancers)
2. For each LB, list listeners (elbv2:DescribeListeners)
3. For HTTPS listeners, extract certificate ARNs
4. Fetch certificate details from ACM (acm:DescribeCertificate)
5. Record: subject, SANs, expiry, issuer, key algorithm
```

Required IAM permissions:
```json
{
  "Effect": "Allow",
  "Action": [
    "elasticloadbalancing:DescribeLoadBalancers",
    "elasticloadbalancing:DescribeListeners",
    "elasticloadbalancing:DescribeListenerCertificates",
    "acm:DescribeCertificate",
    "acm:ListCertificates"
  ],
  "Resource": "*"
}
```

#### Direct TLS Connection

For each discovered endpoint (from LB targets, or user-configured hosts):

```go
func probeCertificate(host string, port int) (*x509.Certificate, error) {
    conn, err := tls.DialWithDialer(
        &net.Dialer{Timeout: 10 * time.Second},
        "tcp",
        fmt.Sprintf("%s:%d", host, port),
        &tls.Config{InsecureSkipVerify: true}, // we validate manually
    )
    if err != nil {
        return nil, err
    }
    defer conn.Close()
    certs := conn.ConnectionState().PeerCertificates
    if len(certs) == 0 {
        return nil, errors.New("no certificates presented")
    }
    return certs[0], nil // leaf certificate
}
```

### 7.3 Checks Performed

| Check | Severity | Logic |
|-------|----------|-------|
| Expiry ≤7 days | Critical | `not_after - now <= 7d` |
| Expiry ≤30 days | High | `not_after - now <= 30d` |
| Expiry ≤60 days | Medium | `not_after - now <= 60d` |
| Expiry ≤90 days | Low | `not_after - now <= 90d` |
| Expired | Critical | `not_after < now` |
| Weak key (RSA <2048) | High | Key size check |
| Weak signature (SHA-1) | High | Signature algorithm check |
| Self-signed | Medium | `issuer == subject` and not in trusted roots |
| Incomplete chain | Medium | Chain validation fails |
| Wildcard on public endpoint | Info | `*.example.com` advisory |

### 7.4 Alert Deduplication

Avoid re-alerting for the same certificate at the same threshold:

```sql
CREATE TABLE cert_alerts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    certificate_id  UUID NOT NULL REFERENCES certificates(id),
    alert_type      TEXT NOT NULL,           -- expiry_90d | expiry_60d | expiry_30d | ...
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    channel         TEXT NOT NULL,           -- slack | email
    UNIQUE(certificate_id, alert_type)       -- only alert once per threshold
);
```

---

## 8. Agent Communication Protocol

### 8.1 mTLS Authentication

All agent ↔ platform communication uses mutual TLS:

- **Platform CA:** Self-managed CA, certificate stored in AWS Secrets Manager
- **Agent certificate:** Issued during registration, signed by platform CA
  - Subject: `CN=ag_<agent_id>.agents.securitycentral.io`
  - Validity: 1 year (auto-renewed during heartbeat)
  - Key type: ECDSA P-256
- **Platform server certificate:** Standard public CA (Let's Encrypt) with `api.securitycentral.io`

**Registration flow:**

```
Agent                                 Platform
  │                                       │
  │  POST /v1/agents/register             │
  │  { api_key, hostname, os_info,        │
  │    csr: <PKCS10 CSR> }               │
  │──────────────────────────────────────►│
  │                                       │  Validate API key
  │                                       │  Sign CSR with CA
  │                                       │  Create server record
  │  { agent_id, signed_cert, ca_cert }   │
  │◄──────────────────────────────────────│
  │                                       │
  │  (all subsequent requests use mTLS)   │
```

### 8.2 Finding Submission Format

```json
POST /v1/agents/findings
Content-Type: application/json

{
  "agent_id": "ag_xxxx",
  "scan_id": "sc_xxxx",
  "scan_type": "infra_packages",
  "started_at": "2025-03-24T06:00:00Z",
  "completed_at": "2025-03-24T06:00:12Z",
  "findings": [
    {
      "type": "package_vulnerability",
      "severity": "high",
      "title": "OpenSSL 3.0.2 vulnerable to CVE-2024-XXXXX",
      "cve_id": "CVE-2024-XXXXX",
      "cvss_score": 8.1,
      "cvss_vector": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N",
      "detail": {
        "package_name": "openssl",
        "installed_version": "3.0.2-0ubuntu1.12",
        "fixed_version": "3.0.2-0ubuntu1.13",
        "os_family": "ubuntu",
        "os_version": "22.04"
      },
      "remediation": "Run: sudo apt-get update && sudo apt-get install openssl=3.0.2-0ubuntu1.13"
    }
  ]
}
```

### 8.3 Retry & Offline Behavior

- Agent stores findings locally (in `/var/lib/securitycentral/queue/`) if platform is unreachable
- Retries with exponential backoff: 1s, 2s, 4s, 8s, ... up to 5 minutes
- Queue holds up to 100 scan results (oldest dropped if exceeded)
- On reconnect, drains local queue in FIFO order

---

## 9. Vulnerability Database

### 9.1 Data Sources (MVP)

| Source | Content | Update Frequency |
|--------|---------|-----------------|
| NVD (NIST) | CVE records with CVSS scores | Every 2 hours (via NVD API 2.0) |
| GitHub Advisory Database | Package-specific advisories with affected version ranges | Every 1 hour (via GitHub API) |
| OSV.dev | Aggregated open-source vulnerability data | Every 1 hour |

### 9.2 Storage Format

**Platform side:** PostgreSQL table for canonical CVE records:

```sql
CREATE TABLE vulnerabilities (
    id              TEXT PRIMARY KEY,                 -- CVE-XXXX-YYYYY
    title           TEXT NOT NULL,
    description     TEXT,
    cvss_score      DECIMAL(3,1),
    cvss_vector     TEXT,
    severity        severity_level NOT NULL,
    published_at    TIMESTAMPTZ,
    modified_at     TIMESTAMPTZ,
    references      TEXT[] NOT NULL DEFAULT '{}',     -- URLs
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE vulnerability_affects (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vulnerability_id TEXT NOT NULL REFERENCES vulnerabilities(id),
    ecosystem       TEXT NOT NULL,                    -- npm | pypi | maven | ubuntu | centos | alpine
    package_name    TEXT NOT NULL,
    version_range   TEXT NOT NULL,                    -- e.g., ">=1.0.0 <1.0.5"
    fixed_version   TEXT,                             -- e.g., "1.0.5" or null if no fix
    os_family       TEXT,                             -- for OS-level vulns
    os_version      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_vuln_affects_lookup
  ON vulnerability_affects(ecosystem, package_name);
```

**Agent side:** BoltDB file (`vulndb.bolt`) compiled from the platform DB.

Key schema:
```
Bucket: "ubuntu:22.04"
  Key:   "openssl"
  Value: [{ "cve_id": "CVE-...", "affected": ">=3.0.0 <3.0.2-0ubuntu1.13", "fixed": "3.0.2-0ubuntu1.13", "cvss": 8.1 }, ...]

Bucket: "npm"
  Key:   "lodash"
  Value: [{ "cve_id": "CVE-...", "affected": ">=4.0.0 <4.17.21", "fixed": "4.17.21", "cvss": 7.4 }, ...]
```

**Delta updates:** Agent requests `GET /v1/agents/vulndb/version` → receives latest version timestamp. If newer, downloads a delta (entries modified since agent's current version), applies to local BoltDB. Full re-download if delta is >50% of total DB.

### 9.3 Vuln DB Sync Pipeline (Platform)

BullMQ recurring job runs every hour:

```
1. Fetch new/modified CVEs from NVD API (since last sync)
2. Fetch new/modified advisories from GitHub Advisory DB
3. Fetch new/modified records from OSV.dev
4. Deduplicate by CVE ID (prefer NVD for CVSS, GitHub for affected version ranges)
5. Upsert into vulnerabilities + vulnerability_affects tables
6. Rebuild BoltDB snapshot for agent distribution
7. Notify agents via heartbeat response: "update_vulndb" command
```

---

## 10. Notification System

### 10.1 Slack Integration

**Setup:** User provides a Slack incoming webhook URL via the dashboard.

**Notification triggers:**

| Event | Conditions | Message |
|-------|------------|---------|
| New critical finding | severity=critical, status=open | Finding title, CVE, affected asset, remediation link |
| Scan completed | findings_new > 0 | Summary: N new findings (X critical, Y high) |
| Certificate expiring | days_until_expiry crosses threshold | Cert subject, days remaining, renewal action |
| Agent offline | No heartbeat for 5 minutes | Server hostname, last seen time |

**Message format (Slack Block Kit):**

```json
{
  "blocks": [
    {
      "type": "header",
      "text": { "type": "plain_text", "text": "🚨 Critical Vulnerability Found" }
    },
    {
      "type": "section",
      "fields": [
        { "type": "mrkdwn", "text": "*CVE:* CVE-2024-XXXXX" },
        { "type": "mrkdwn", "text": "*Severity:* Critical (9.8)" },
        { "type": "mrkdwn", "text": "*Package:* openssl 3.0.2" },
        { "type": "mrkdwn", "text": "*Asset:* api-server-01 (production)" }
      ]
    },
    {
      "type": "actions",
      "elements": [
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "View Finding" },
          "url": "https://app.securitycentral.io/findings/xxx"
        }
      ]
    }
  ]
}
```

### 10.2 Email Notifications

MVP: Daily digest email (configurable per-user):
- Summary of new findings (grouped by severity)
- Certificates expiring soon
- Agents that went offline
- Sent via transactional email service (AWS SES)

### 10.3 Notification Preferences

```sql
CREATE TABLE notification_preferences (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    channel         TEXT NOT NULL,                    -- slack | email
    event_type      TEXT NOT NULL,                    -- critical_finding | scan_complete | cert_expiry | agent_offline
    enabled         BOOLEAN NOT NULL DEFAULT true,
    UNIQUE(user_id, channel, event_type)
);
```

---

## 11. Authentication & Authorization

### 11.1 Authentication Methods

| Method | Use Case | Implementation |
|--------|----------|----------------|
| Email/password | Dashboard login | bcrypt hash, JWT (access + refresh) |
| API key | CI/CD, CLI, programmatic access | SHA-256 hashed, prefix-based lookup |
| mTLS client cert | Agent ↔ platform | ECDSA P-256, platform CA-signed |
| GitHub OAuth | GitHub App installation | OAuth 2.0 flow for repo access |

### 11.2 Authorization Model

RBAC with four roles:

| Permission | Owner | Admin | Member | Viewer |
|------------|-------|-------|--------|--------|
| Manage org settings | Yes | Yes | No | No |
| Manage integrations | Yes | Yes | No | No |
| Manage users | Yes | Yes | No | No |
| Create/revoke API keys | Yes | Yes | Yes (own) | No |
| View findings | Yes | Yes | Yes | Yes |
| Update finding status | Yes | Yes | Yes | No |
| Trigger scans | Yes | Yes | Yes | No |
| View dashboard | Yes | Yes | Yes | Yes |

Enforced via middleware that reads `role` from JWT and checks against route-level permission requirements.

### 11.3 API Key Scopes

Scopes allow limiting API key permissions beyond role:

| Scope | Allows |
|-------|--------|
| `scan:write` | Submit scan results |
| `findings:read` | Read findings |
| `findings:write` | Update finding status |
| `assets:read` | Read repositories, servers, certs |
| `assets:write` | Register/remove assets |

---

## 12. Deployment Architecture

### 12.1 AWS Infrastructure (MVP)

```
┌─────────────────────────────────────────────────────────────────┐
│                         VPC                                     │
│                                                                 │
│  ┌─────────────┐    ┌─────────────────────────────────────┐    │
│  │ CloudFront  │    │  Public Subnet                      │    │
│  │ (Dashboard) │    │  ┌───────────┐   ┌───────────┐     │    │
│  └─────────────┘    │  │ ALB       │   │ NAT GW    │     │    │
│                     │  │ (API)     │   │           │     │    │
│                     │  └─────┬─────┘   └───────────┘     │    │
│                     └────────┼────────────────────────────┘    │
│                              │                                  │
│  ┌───────────────────────────┼──────────────────────────────┐  │
│  │  Private Subnet                                          │  │
│  │                                                          │  │
│  │  ┌─────────────────┐   ┌──────────────┐                 │  │
│  │  │ ECS Fargate     │   │ ECS Fargate  │                 │  │
│  │  │ (Platform API)  │   │ (Workers)    │                 │  │
│  │  │ 2-10 tasks      │   │ 2-5 tasks    │                 │  │
│  │  └─────────────────┘   └──────────────┘                 │  │
│  │                                                          │  │
│  │  ┌──────────┐  ┌──────────┐  ┌────────────────────┐    │  │
│  │  │ RDS      │  │ Elasti-  │  │ ElastiCache        │    │  │
│  │  │ Postgres │  │ cache    │  │ (Elasticsearch -   │    │  │
│  │  │ (r6g.lg) │  │ Redis    │  │  OpenSearch t3.med)│    │  │
│  │  │          │  │ (r6g.lg) │  │                    │    │  │
│  │  └──────────┘  └──────────┘  └────────────────────┘    │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 12.2 ECS Service Definitions

**Platform API:**
- Image: `securitycentral/platform-api`
- CPU: 1 vCPU, Memory: 2 GB
- Autoscale: 2–10 tasks, target CPU 60%
- Health check: `GET /health`
- Env: `DATABASE_URL`, `REDIS_URL`, `ELASTICSEARCH_URL`, `JWT_SECRET`, `GITHUB_APP_*`

**Workers (BullMQ processors):**
- Image: `securitycentral/platform-api` (same image, different entrypoint: `node dist/worker.js`)
- CPU: 1 vCPU, Memory: 2 GB
- Autoscale: 2–5 tasks, based on queue depth
- Processes queues: `scan-orchestration`, `finding-ingestion`, `notifications`, `vulndb-sync`, `github-pr`

**Cert Monitor:**
- Image: `securitycentral/certmon`
- Runs as ECS Scheduled Task (every 1 hour)
- CPU: 0.5 vCPU, Memory: 512 MB
- IAM role with ALB/ACM read permissions

### 12.3 Database Configuration

**PostgreSQL (RDS):**
- Engine: PostgreSQL 16
- Instance: `db.r6g.large` (2 vCPU, 16 GB RAM)
- Storage: 100 GB gp3, autoscale to 500 GB
- Multi-AZ: Yes
- Backup: 7-day automated, point-in-time recovery
- Encryption: AES-256 (AWS managed key)

**Redis (ElastiCache):**
- Engine: Redis 7
- Instance: `cache.r6g.large`
- Usage: BullMQ job queue + dashboard cache + WebSocket pub/sub
- Persistence: AOF for queue durability

**OpenSearch (Elasticsearch-compatible):**
- Instance: `t3.medium.search` (2 nodes)
- Storage: 100 GB per node
- Usage: Finding search and dashboard aggregations

### 12.4 CI/CD Pipeline

```
GitHub push to main
  │
  ├── Platform API
  │   ├── npm test
  │   ├── npm run lint
  │   ├── docker build
  │   ├── push to ECR
  │   └── ECS rolling deploy
  │
  ├── Dashboard
  │   ├── npm test
  │   ├── npm run build
  │   └── S3 sync + CloudFront invalidation
  │
  └── Go Components (sc-scan, sc-agent, sc-certmon)
      ├── go test ./...
      ├── go vet ./...
      ├── goreleaser (cross-compile linux/amd64, linux/arm64, darwin/amd64, darwin/arm64)
      ├── sign binaries (ed25519)
      └── upload to S3 release bucket + Docker Hub
```

---

## 13. Non-Functional Requirements

### 13.1 Performance

| Metric | Target |
|--------|--------|
| API response (p95) | <200ms for list endpoints, <50ms for single resource |
| Finding search (p95) | <500ms for complex filtered queries |
| Dashboard load | <2s initial load, <500ms subsequent navigation |
| Scan result ingestion | Process 10,000 findings/minute |
| WebSocket latency | <1s from finding ingestion to dashboard update |
| Agent heartbeat processing | <100ms per heartbeat |
| Code scanner (1,000 files) | <30s total scan time |
| Infra agent scan | <60s for package enumeration + comparison |

### 13.2 Scalability

| Dimension | MVP Capacity | Design Limit |
|-----------|-------------|--------------|
| Organizations | 50 | 5,000 |
| Findings per org | 100,000 | 10,000,000 |
| Servers per org | 100 | 10,000 |
| Repositories per org | 250 | 5,000 |
| Concurrent agents | 1,000 | 100,000 |
| Concurrent dashboard users | 100 | 10,000 |

Scaling strategy: Horizontal scaling of API and worker tasks via ECS autoscaling. PostgreSQL read replicas for dashboard queries. Elasticsearch sharding for finding search.

### 13.3 Availability

| Component | Target | Strategy |
|-----------|--------|----------|
| Platform API | 99.9% | Multi-AZ ECS, ALB health checks |
| Database | 99.95% | RDS Multi-AZ, automated failover |
| Agent data collection | Tolerant of 24h outage | Local queue on agent, retry on reconnect |
| Dashboard | 99.9% | CloudFront CDN, S3 origin |

### 13.4 Security

| Concern | Mitigation |
|---------|------------|
| Data in transit | TLS 1.2+ for all connections; mTLS for agents |
| Data at rest | RDS encryption (AES-256), S3 SSE, ElastiCache encryption |
| Secrets management | AWS Secrets Manager for DB creds, JWT secret, CA private key |
| API authentication | JWT + API key with scoped permissions |
| Agent authentication | mTLS with per-agent client certificates |
| Input validation | Zod schema validation on all API inputs |
| SQL injection | Parameterized queries via Prisma ORM |
| Rate limiting | Per-org rate limits: 100 req/s API, 1000 req/s agents |
| Audit trail | All state changes logged with user/agent ID and timestamp |
| Dependency security | Dependabot on our own repos, `npm audit` in CI |

### 13.5 Data Retention

| Data | Retention | Rationale |
|------|-----------|-----------|
| Findings (open) | Indefinite | Active security issues |
| Findings (resolved) | 1 year (3 years add-on) | Compliance audit trail |
| Scan records | 1 year | Historical analysis |
| Agent heartbeats | 30 days | Troubleshooting |
| Audit logs | 2 years | Compliance |
| Vulnerability DB | Current only (superseded records archived) | Storage efficiency |

---

## 14. Observability

### 14.1 Logging

- **Structured JSON logs** (all services)
- **Log aggregation:** CloudWatch Logs (ECS) → optional export to customer SIEM
- **Log levels:** `debug`, `info`, `warn`, `error`
- **Correlation:** Every request gets a `request_id` (UUID) propagated through all async jobs

### 14.2 Metrics (CloudWatch + Prometheus)

**Platform API:**
- `http_request_duration_seconds` (histogram, by route, method, status)
- `http_requests_total` (counter, by route, method, status)
- `ws_connections_active` (gauge)
- `bullmq_queue_depth` (gauge, by queue name)
- `bullmq_job_duration_seconds` (histogram, by queue name)
- `bullmq_job_failures_total` (counter, by queue name)

**Agents:**
- `agent_heartbeats_total` (counter)
- `agent_heartbeat_failures_total` (counter)
- `agents_active` (gauge, by os_family, environment)
- `agent_scan_duration_seconds` (histogram)
- `findings_ingested_total` (counter, by source, severity)

**Business metrics:**
- `findings_open` (gauge, by org, severity, source)
- `findings_mttr_seconds` (histogram) — time from first_seen to resolved
- `scans_completed_total` (counter, by type, trigger)

### 14.3 Alerting

| Alert | Condition | Channel |
|-------|-----------|---------|
| API error rate >5% | 5xx responses / total > 0.05 over 5min | PagerDuty |
| API latency p95 >2s | Sustained for 5min | PagerDuty |
| Queue depth >1000 | Any queue, sustained 10min | Slack #ops |
| Database connections >80% | RDS connections | Slack #ops |
| Agent heartbeat failures >10% | Across all agents, 5min window | Slack #ops |
| Vuln DB sync failure | 2 consecutive failures | Slack #ops |
| Disk usage >80% | RDS, OpenSearch | Slack #ops |

---

## 15. Phase 2/3 Extension Points

The MVP architecture includes these deliberate extension points:

### Phase 2 (Months 5–8)

| Feature | Extension Point |
|---------|----------------|
| **AI Agents** | New `ai/` module in platform API. Findings already have `cve_id` for cross-source correlation. Add `risk_score` computed column to findings. AI agent consumes findings via internal API, writes enrichment back. |
| **SAST (Python)** | New scanner in `go/internal/scanner/sast/`. Findings use same submission API. Add `scan_type: code_sast` to enum. AST parsing via `go/ast`-equivalent for Python (tree-sitter). |
| **Container scanning** | New scanner in `go/internal/scanner/container/`. Parse Dockerfile / image manifest, enumerate packages in layers, compare to vuln DB. |
| **GCP/Azure** | Cert monitor: add cloud discovery adapters. Infra agent: already cross-platform. Platform: add `cloud_provider` enum values. |
| **Jira/Linear** | New integration adapters in `platform-api/src/modules/integrations/`. BullMQ job for ticket creation on new critical findings. |

### Phase 3 (Months 9–12)

| Feature | Extension Point |
|---------|----------------|
| **SSH-based scanning** | New `ssh-scanner` service (Go). Connects to targets, runs package enumeration commands, submits findings via same agent API (using API key auth instead of mTLS). |
| **Compliance automation** | New `compliance/` module. Maps findings → control frameworks (CIS, PCI, SOC2). New tables: `compliance_frameworks`, `compliance_controls`, `compliance_evidence`. |
| **IaC scanning** | New scanner in `go/internal/scanner/iac/`. Parse HCL (Terraform), CloudFormation YAML/JSON. Rule engine for misconfigurations. |
| **SAML/SSO** | Add `passport-saml` to auth module. New table `saml_configs` per org. |
| **On-premises** | Docker Compose / Helm chart packaging of all services. All external service dependencies (Postgres, Redis, ES) configurable via env vars. |

---

## Appendix A: Error Codes

All API errors return:

```json
{
  "errors": [
    {
      "code": "FINDING_NOT_FOUND",
      "message": "Finding with ID xxx not found",
      "status": 404
    }
  ]
}
```

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `AUTH_INVALID_CREDENTIALS` | 401 | Wrong email/password |
| `AUTH_TOKEN_EXPIRED` | 401 | JWT expired |
| `AUTH_INSUFFICIENT_SCOPE` | 403 | API key lacks required scope |
| `AUTH_FORBIDDEN` | 403 | Role lacks permission |
| `RESOURCE_NOT_FOUND` | 404 | Entity not found |
| `VALIDATION_ERROR` | 422 | Request body/params validation failed |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `AGENT_ALREADY_REGISTERED` | 409 | Agent ID collision |
| `INTEGRATION_ALREADY_EXISTS` | 409 | Duplicate integration provider |
| `SCAN_ALREADY_RUNNING` | 409 | Asset already has an active scan |
| `PLAN_LIMIT_EXCEEDED` | 402 | Org exceeded plan limits (servers, repos, domains) |

## Appendix B: Configuration Reference

### Environment Variables (Platform API)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `ELASTICSEARCH_URL` | Yes | Elasticsearch endpoint |
| `JWT_SECRET` | Yes | Secret for signing JWTs |
| `JWT_REFRESH_SECRET` | Yes | Secret for refresh tokens |
| `AGENT_CA_CERT` | Yes | CA certificate for agent mTLS (PEM) |
| `AGENT_CA_KEY` | Yes | CA private key for signing agent certs (PEM) |
| `GITHUB_APP_ID` | No | GitHub App ID |
| `GITHUB_APP_PRIVATE_KEY` | No | GitHub App private key (PEM) |
| `GITHUB_WEBHOOK_SECRET` | No | GitHub webhook HMAC secret |
| `SLACK_SIGNING_SECRET` | No | Slack request verification |
| `AWS_REGION` | No | AWS region for SES, ACM discovery |
| `SES_FROM_EMAIL` | No | Sender email for notifications |
| `PORT` | No | API server port (default: 3000) |
| `LOG_LEVEL` | No | Logging level (default: info) |
| `CORS_ORIGINS` | No | Allowed CORS origins (comma-separated) |
