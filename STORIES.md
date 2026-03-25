# SecurityCentral — Stories & Tasks (MVP / Phase 1)

> Organized by Epic → Story → Task. Each task is independently actionable.
> Scope: Phase 1 MVP (Months 1–4)
>
> **Conventions:**
> - `depends: T-X.Y.Z` = must complete before this task starts
> - `size: S/M/L/XL` = relative effort (S=hours, M=1–2 days, L=3–5 days, XL=1–2 weeks)
> - Each story has **Acceptance Criteria** — the story is done when all AC are met

---

## Epic 1: Project Foundation & Infrastructure

### Story 1.1: Project Scaffolding

Set up monorepo structure, tooling, and initial configuration for all components.

**Acceptance Criteria:**
- All three codebases (platform-api, dashboard, go/) build cleanly
- `docker compose up` starts PostgreSQL, Redis, and OpenSearch with health checks passing
- `make dev`, `make test`, `make lint` work for all components

**Tasks:**

- [x] **T-1.1.1** Initialize monorepo root with `package.json` (workspaces), `.gitignore`, `.editorconfig`, `prettier`/`eslint` configs — `size: S`
- [x] **T-1.1.2** Scaffold `platform-api/` — Node.js + TypeScript with Express, `tsconfig.json`, directory structure (`src/modules/`, `src/jobs/`, `src/ws/`, `src/middleware/`, `src/lib/`) — `size: M`
- [x] **T-1.1.3** Scaffold `dashboard/` — React + TypeScript (Vite), directory structure (`src/pages/`, `src/components/`, `src/hooks/`, `src/api/`, `src/ws/`) — `size: M`
- [x] **T-1.1.4** Scaffold `go/` — Go module with `cmd/sc-scan/`, `cmd/sc-agent/`, `cmd/sc-certmon/`, `internal/`, `pkg/models/`, `go.mod` — `size: M`
- [x] **T-1.1.5** Add Docker Compose for local dev: PostgreSQL 16, Redis 7, OpenSearch, with health checks and volume mounts — `size: M`
- [x] **T-1.1.6** Add `Makefile` with targets: `dev`, `test`, `lint`, `build`, `docker-up`, `docker-down`, `migrate` — `size: S`

### Story 1.2: Database Schema & Migrations

Implement the full PostgreSQL schema from the spec using Prisma ORM.

**Acceptance Criteria:**
- `prisma migrate dev` applies cleanly to a fresh PostgreSQL instance
- All tables, enums, indexes, and unique constraints match the spec
- Seed script populates test data successfully

**Tasks:**

- [x] **T-1.2.1** Install Prisma in `platform-api/`, configure `DATABASE_URL` env var, create initial `schema.prisma` — `size: S`
- [x] **T-1.2.2** Define core identity models: `Organization` (id, name, slug, plan, settings, timestamps), `User` (id, org_id, email, name, role, password_hash, timestamps), `ApiKey` (id, org_id, created_by, name, key_hash, key_prefix, scopes, last_used_at, expires_at) — `size: M`
- [x] **T-1.2.3** Define asset models: `Repository` (provider, provider_id, owner, name, default_branch, language, last_scan_at, unique org+provider+provider_id), `Server` (agent_id unique, hostname, os_family, os_version, arch, cloud fields, environment, agent_version, last_heartbeat, status, metadata JSONB), `Certificate` (subject_cn, sans, issuer_cn, serial_number, fingerprint_sha256, not_before/not_after, key/signature algorithms, chain_valid, discovered_from, status, unique org+fingerprint) — `size: M`
- [x] **T-1.2.4** Define operational models: `Scan` (scan_type enum, status enum, trigger, repository_id/server_id, findings_total/new/resolved, error_message, duration_ms, metadata JSONB), `Finding` (source enum, severity enum, status enum, title, description, cve_id, cvss_score, cvss_vector, repository_id/server_id/certificate_id FKs, detail JSONB, remediation, auto_fixable, fix_pr_url, scan_id, first_seen_at, resolved_at), `Integration` (provider, status, config JSONB, unique org+provider), `CertAlert` (certificate_id, alert_type, sent_at, channel, unique cert+alert_type), `NotificationPreference` (user_id, channel, event_type, enabled, unique user+channel+event) — `size: M`
- [x] **T-1.2.5** Define vulnerability models: `Vulnerability` (id=CVE ID as PK, title, description, cvss_score, cvss_vector, severity, published_at, modified_at, references array), `VulnerabilityAffects` (vulnerability_id FK, ecosystem, package_name, version_range, fixed_version, os_family, os_version; index on ecosystem+package_name) — `size: M`
- [x] **T-1.2.6** Add indexes per spec: `findings(org_id, status)`, `findings(org_id, severity)`, `findings(cve_id)`, `findings(repository_id)`, `findings(server_id)`, `findings(certificate_id)`, `vulnerability_affects(ecosystem, package_name)` — `size: S`
- [x] **T-1.2.7** Run `prisma migrate dev`, verify schema in PostgreSQL; write seed script (`prisma/seed.ts`) with sample org, users, repos, servers, certs, findings — `size: M`

### Story 1.3: Elasticsearch Setup

Configure Elasticsearch index for findings search/aggregation.

**Acceptance Criteria:**
- ES index created with correct field mappings
- Finding upsert/search roundtrip works in integration test

**Tasks:**

- [x] **T-1.3.1** Create ES index template with mapping per spec: keyword fields (id, org_id, source, severity, status, cve_id, repository_id, server_id, certificate_id), text (title, description), float (cvss_score), boolean (auto_fixable), date (first_seen_at, resolved_at, created_at) — `size: M` | `depends: T-1.1.5`
- [x] **T-1.3.2** Implement ES client wrapper in `platform-api/src/lib/elasticsearch.ts` with connection pooling, health check, and index initialization on startup — `size: M`
- [x] **T-1.3.3** Implement finding sync service: on finding INSERT/UPDATE in PostgreSQL, enqueue BullMQ job to upsert document into ES by `id` — `size: M` | `depends: T-1.4.1`
- [x] **T-1.3.4** Write integration test verifying finding → ES sync roundtrip (insert finding in PG, verify it appears in ES within timeout) — `size: S`

### Story 1.4: Job Queue Infrastructure

Set up BullMQ queues and worker process.

**Acceptance Criteria:**
- All queues defined and discoverable
- Worker process starts, connects to Redis, and processes jobs
- Worker health check endpoint responds

**Tasks:**

- [x] **T-1.4.1** Define BullMQ queues in `platform-api/src/jobs/queues.ts`: `scan-orchestration`, `finding-ingestion`, `notifications`, `vulndb-sync`, `github-pr`, `es-sync` — `size: S` | `depends: T-1.1.5`
- [x] **T-1.4.2** Implement worker entrypoint (`src/worker.ts`) — register processors for all queues with concurrency limits, graceful shutdown — `size: M`
- [x] **T-1.4.3** Add health check endpoint for worker process (`/health` returns queue connection status) — `size: S`

### Story 1.5: Cross-Cutting Middleware

Implement shared middleware used by all API routes.

**Acceptance Criteria:**
- Rate limiting enforced per-org
- CORS configured from env var
- All errors returned in standard envelope format with error codes
- Request IDs propagated through all requests and jobs

**Tasks:**

- [ ] **T-1.5.1** Implement standardized error handling framework — error classes for each code in spec Appendix A (`AUTH_INVALID_CREDENTIALS`, `AUTH_TOKEN_EXPIRED`, `AUTH_INSUFFICIENT_SCOPE`, `AUTH_FORBIDDEN`, `RESOURCE_NOT_FOUND`, `VALIDATION_ERROR`, `RATE_LIMIT_EXCEEDED`, `AGENT_ALREADY_REGISTERED`, `INTEGRATION_ALREADY_EXISTS`, `SCAN_ALREADY_RUNNING`, `PLAN_LIMIT_EXCEEDED`), global error handler middleware returning `{ data, meta, errors }` envelope — `size: M`
- [ ] **T-1.5.2** Implement rate limiting middleware — per-org limits: 100 req/s for API routes, 1000 req/s for agent routes; use Redis sliding window; return `429` with `RATE_LIMIT_EXCEEDED` code — `size: M` | `depends: T-1.1.5`
- [ ] **T-1.5.3** Implement CORS middleware — read allowed origins from `CORS_ORIGINS` env var (comma-separated), apply to all routes — `size: S`
- [ ] **T-1.5.4** Implement request ID middleware — generate UUID `request_id` per request, attach to request context, include in all log output and response headers — `size: S`
- [ ] **T-1.5.5** Implement Zod request validation middleware — generic wrapper that validates `body`, `query`, `params` against a Zod schema, returns `VALIDATION_ERROR` on failure — `size: S`
- [ ] **T-1.5.6** Write tests for error handling, rate limiting, CORS, and validation middleware — `size: M`

### Story 1.6: Structured Logging

Consistent JSON logging across all services.

**Acceptance Criteria:**
- All platform-api logs are structured JSON with request_id correlation
- Go components log structured JSON with correlation IDs

**Tasks:**

- [ ] **T-1.6.1** Implement structured logger in platform-api — JSON format, configurable level via `LOG_LEVEL` env var, `request_id` correlation — `size: S`
- [ ] **T-1.6.2** Add request logging middleware — log method, path, status, duration, request_id for every request — `size: S` | `depends: T-1.5.4`
- [ ] **T-1.6.3** Propagate `request_id` through BullMQ jobs (attach to job data, include in all job logs) — `size: S` | `depends: T-1.4.1`
- [ ] **T-1.6.4** Implement structured logging in Go components — JSON format with correlation IDs — `size: M`

### Story 1.7: CI/CD Pipeline

Set up GitHub Actions for automated testing and deployment.

**Acceptance Criteria:**
- PRs run lint + test for all components
- Merge to main triggers build + deploy for each component

**Tasks:**

- [ ] **T-1.7.1** Create `.github/workflows/platform-api.yml` — lint, test, build Docker image, push to ECR on main — `size: M`
- [ ] **T-1.7.2** Create `.github/workflows/dashboard.yml` — lint, test, build, deploy to S3 + CloudFront invalidation on main — `size: M`
- [ ] **T-1.7.3** Create `.github/workflows/go.yml` — `go test ./...`, `go vet ./...`, `goreleaser` cross-compile (linux/amd64, linux/arm64, darwin/amd64, darwin/arm64), sign binaries with ed25519 — `size: M`
- [ ] **T-1.7.4** Create `.github/workflows/pr-checks.yml` — run all tests + lint on pull requests (all components) — `size: S`

---

## Epic 2: Authentication & Authorization

### Story 2.1: User Registration & Login

Implement email/password auth with JWT tokens.

**Acceptance Criteria:**
- New org + user can register, login, and receive JWT pair
- Access token expires after 1h, refresh token works for 30d
- Invalid credentials return proper error codes

**Tasks:**

- [ ] **T-2.1.1** Create `auth` module structure: `src/modules/auth/auth.router.ts`, `auth.service.ts`, `auth.validation.ts` — `size: S`
- [ ] **T-2.1.2** Create JWT utility (`src/lib/jwt.ts`) — sign/verify access and refresh tokens using `JWT_SECRET` / `JWT_REFRESH_SECRET`, access TTL 1h, refresh TTL 30d — `size: S`
- [ ] **T-2.1.3** Implement `POST /auth/register` — Zod validation, create org + first user (owner role), hash password with bcrypt, return JWT pair — `size: M` | `depends: T-1.2.7, T-1.5.1, T-1.5.5`
- [ ] **T-2.1.4** Implement `POST /auth/login` — validate email/password, return access token + refresh token (HttpOnly cookie) — `size: M`
- [ ] **T-2.1.5** Implement `POST /auth/refresh` — validate refresh token from cookie, issue new access token — `size: S`
- [ ] **T-2.1.6** Implement auth middleware (`src/middleware/auth.ts`) — extract JWT from `Authorization: Bearer` header, attach `user` + `org` to request context; also support `X-API-Key` fallback (delegates to API key middleware) — `size: M`
- [ ] **T-2.1.7** Write unit + integration tests for register, login, refresh, invalid credentials, expired token — `size: M`

### Story 2.2: API Key Management

Allow programmatic access via API keys for CLI/CI/CD.

**Acceptance Criteria:**
- API keys can be created (raw key shown once), listed (prefix only), and revoked
- API key auth works in middleware with scope checking
- Scopes correctly restrict access

**Tasks:**

- [ ] **T-2.2.1** Implement `POST /auth/api-keys` — generate random key (`sc_live_` prefix), return raw key once, store SHA-256 hash + first 8 chars as prefix; validate scopes from `scan:write`, `findings:read`, `findings:write`, `assets:read`, `assets:write` — `size: M` | `depends: T-2.1.6`
- [ ] **T-2.2.2** Implement `GET /auth/api-keys` — list API keys for org (show prefix, name, scopes, last_used_at, expires_at; never return hash) — `size: S`
- [ ] **T-2.2.3** Implement `DELETE /auth/api-keys/:id` — revoke API key (delete from DB) — `size: S`
- [ ] **T-2.2.4** Implement API key auth path in auth middleware — on `X-API-Key` header: lookup candidates by prefix, verify SHA-256 hash, check scopes against route requirements, update `last_used_at` — `size: M`
- [ ] **T-2.2.5** Write tests for API key creation, authentication, scope checking, revocation, and expired key rejection — `size: M`

### Story 2.3: RBAC Authorization

Enforce role-based access control per spec permission matrix.

**Acceptance Criteria:**
- Each role (owner, admin, member, viewer) has correct access per spec table
- Unauthorized access returns `AUTH_FORBIDDEN` (403)

**Tasks:**

- [ ] **T-2.3.1** Create RBAC middleware (`src/middleware/rbac.ts`) — read `role` from JWT, check against route-level permission requirements; return `AUTH_FORBIDDEN` error on failure — `size: M`
- [ ] **T-2.3.2** Define permission map per spec: owner/admin (manage org, integrations, users, all else), member (view + update findings + trigger scans + manage own API keys), viewer (read-only: view findings, dashboard) — `size: S`
- [ ] **T-2.3.3** Apply RBAC middleware to all routes with appropriate permission levels — `size: S` | `depends: all route implementations`
- [ ] **T-2.3.4** Write tests verifying each role's access to protected endpoints (positive + negative cases for each role) — `size: M`

---

## Epic 3: Platform API — Core Modules

### Story 3.1: Findings Module

CRUD + search for vulnerability findings.

**Acceptance Criteria:**
- Findings can be listed with all spec filters, paginated, sorted
- Full-text search routes through Elasticsearch
- Status transitions work correctly, resolved_at set on resolution
- Stats and trends endpoints return correct aggregations

**Tasks:**

- [ ] **T-3.1.1** Create findings module structure: `findings.router.ts`, `findings.service.ts`, `findings.validation.ts` — `size: S`
- [ ] **T-3.1.2** Implement `GET /findings` — paginated list with filters (severity, status, source, cve_id, repository_id, server_id, certificate_id, full-text `q`), sort, order. Route simple queries to PostgreSQL, full-text/complex queries to Elasticsearch. Return standard envelope `{ data, meta: { page, per_page, total }, errors }` — `size: L` | `depends: T-1.3.2, T-1.5.5`
- [ ] **T-3.1.3** Implement `GET /findings/:id` — single finding detail with joined asset info (repo name, server hostname, or cert subject) — `size: S`
- [ ] **T-3.1.4** Implement `PATCH /findings/:id` — update status (open → in_progress → resolved/suppressed/false_positive), set `resolved_at` on resolution, sync updated status to ES — `size: M`
- [ ] **T-3.1.5** Implement `GET /findings/stats` — aggregated counts by severity, source, status using Elasticsearch aggregations — `size: M`
- [ ] **T-3.1.6** Implement `GET /findings/trends` — time-series: new/resolved findings bucketed by day/week over configurable time window — `size: M`
- [ ] **T-3.1.7** Write Zod validation schemas for all query params and request bodies — `size: S`
- [ ] **T-3.1.8** Write unit + integration tests for findings CRUD, filtering, pagination, search, stats, trends — `size: L`

### Story 3.2: Assets Module — Repositories

Manage code repository assets.

**Acceptance Criteria:**
- Repos can be registered, listed, viewed with scan summary, deleted
- Manual scan trigger enqueues BullMQ job

**Tasks:**

- [ ] **T-3.2.1** Create assets module structure: `assets/repositories.router.ts`, `repositories.service.ts` — `size: S`
- [ ] **T-3.2.2** Implement `GET /repositories` — list repos for org, paginated — `size: S`
- [ ] **T-3.2.3** Implement `POST /repositories` — register repository (provider, provider_id, owner, name, default_branch); enforce unique constraint — `size: S`
- [ ] **T-3.2.4** Implement `GET /repositories/:id` — repo detail + latest scan summary + finding counts grouped by severity — `size: M`
- [ ] **T-3.2.5** Implement `DELETE /repositories/:id` — remove repository and associated data — `size: S`
- [ ] **T-3.2.6** Implement `POST /repositories/:id/scan` — validate no active scan (`SCAN_ALREADY_RUNNING`), create pending scan record, enqueue `scan-orchestration` BullMQ job — `size: M` | `depends: T-1.4.1`
- [ ] **T-3.2.7** Write tests for repository CRUD and manual scan trigger — `size: M`

### Story 3.3: Assets Module — Servers

Manage infrastructure server assets (populated by agent registration).

**Acceptance Criteria:**
- Servers listed with status, heartbeat, environment filters
- Server detail includes packages and findings
- Decommission correctly updates status

**Tasks:**

- [ ] **T-3.3.1** Implement `GET /servers` — list servers for org with filters: status, environment, os_family; include last_heartbeat, finding counts — `size: M`
- [ ] **T-3.3.2** Implement `GET /servers/:id` — server detail with agent info, OS info, resource usage, recent findings — `size: M`
- [ ] **T-3.3.3** Implement `DELETE /servers/:id` — mark server as `decommissioned` (soft delete) — `size: S`
- [ ] **T-3.3.4** Write tests for server listing, detail, and decommission — `size: S`

### Story 3.4: Assets Module — Certificates

Manage discovered SSL certificates.

**Acceptance Criteria:**
- Certificates listed with status filter
- Expiring endpoint returns certs within N days
- Detail includes full chain info

**Tasks:**

- [ ] **T-3.4.1** Implement `GET /certificates` — list certificates for org with status filter (active, expiring, expired, revoked) — `size: S`
- [ ] **T-3.4.2** Implement `GET /certificates/:id` — certificate detail with chain info, SANs, algorithm, issuer — `size: S`
- [ ] **T-3.4.3** Implement `GET /certificates/expiring` — certificates expiring within N days (query param, default 30) — `size: S`
- [ ] **T-3.4.4** Write tests for certificate endpoints — `size: S`

### Story 3.5: Scans Module

Track scan lifecycle.

**Acceptance Criteria:**
- Scans listed and filterable by type, status, asset
- Cancel correctly stops a running/pending scan
- Scan detail includes findings summary

**Tasks:**

- [ ] **T-3.5.1** Implement `GET /scans` — list scans filterable by type, status, repository_id, server_id; paginated — `size: M`
- [ ] **T-3.5.2** Implement `GET /scans/:id` — scan detail with findings summary (total, new, resolved), error message if failed — `size: S`
- [ ] **T-3.5.3** Implement `POST /scans/:id/cancel` — cancel a running/pending scan (update status to `cancelled`) — `size: S`
- [ ] **T-3.5.4** Write tests for scan endpoints — `size: S`

### Story 3.6: Dashboard Module

Aggregation endpoints for the web dashboard.

**Acceptance Criteria:**
- Summary returns correct counts cached in Redis
- Top risks returns highest CVSS findings
- Assets overview shows health per category

**Tasks:**

- [ ] **T-3.6.1** Implement `GET /dashboard/summary` — org-wide counts: total findings by severity, open vs resolved, total assets by type — `size: M` | `depends: T-1.3.2`
- [ ] **T-3.6.2** Implement `GET /dashboard/top-risks` — top 10 highest-risk open findings (CVSS score × severity) — `size: M`
- [ ] **T-3.6.3** Implement `GET /dashboard/assets-overview` — asset counts (repos, servers, certs) + health status (% with open critical/high findings) — `size: M`
- [ ] **T-3.6.4** Add Redis caching for dashboard queries (TTL: 30s for summary, 60s for top-risks) — invalidate on new finding ingestion — `size: M` | `depends: T-1.1.5`
- [ ] **T-3.6.5** Write tests for dashboard endpoints including cache hit/miss/invalidation — `size: M`

### Story 3.7: Audit Trail

Log all state changes for compliance.

**Acceptance Criteria:**
- Every finding status change, scan trigger, integration change logged with actor and timestamp
- Audit log queryable by entity

**Tasks:**

- [ ] **T-3.7.1** Create `audit_logs` table: id, org_id, actor_type (user/agent/system), actor_id, action (e.g., `finding.status_changed`), entity_type, entity_id, old_value JSONB, new_value JSONB, timestamp — `size: M`
- [ ] **T-3.7.2** Implement audit logging service — called from findings (status change), scans (trigger/cancel), integrations (create/delete), API keys (create/revoke) — `size: M`
- [ ] **T-3.7.3** Implement `GET /audit-logs` — list audit logs for org, filterable by entity_type, entity_id, actor, date range — `size: M`
- [ ] **T-3.7.4** Write tests for audit log creation and querying — `size: S`

---

## Epic 4: Agent Communication & Registration

### Story 4.1: mTLS Infrastructure

Set up mutual TLS for agent-to-platform communication.

**Acceptance Criteria:**
- CA can sign CSRs and produce valid agent certificates
- Agent routes reject connections without valid client cert

**Tasks:**

- [ ] **T-4.1.1** Create self-managed CA utility: generate CA key pair (ECDSA P-256) for dev/test; production CA loaded from `AGENT_CA_CERT`/`AGENT_CA_KEY` env vars — `size: M`
- [ ] **T-4.1.2** Implement CSR signing utility in `platform-api/src/lib/ca.ts` — accept PKCS10 CSR, sign with CA key, return signed cert (1-year validity, CN=`ag_<id>.agents.securitycentral.io`) — `size: M`
- [ ] **T-4.1.3** Configure platform API to accept mTLS connections on agent routes (`/v1/agents/*`) — verify client cert signed by platform CA — `size: M`
- [ ] **T-4.1.4** Write tests for CSR signing, certificate validation, and mTLS connection rejection — `size: M`

### Story 4.2: Agent Registration & Heartbeat

Platform-side handling of agent lifecycle.

**Acceptance Criteria:**
- Agent can register and receive agent_id + signed cert
- Heartbeat updates server record and returns commands
- Offline agents detected within 5 minutes and notification triggered

**Tasks:**

- [ ] **T-4.2.1** Create agents module: `agents.router.ts`, `agents.service.ts` — `size: S`
- [ ] **T-4.2.2** Implement `POST /agents/register` — validate API key, accept CSR, sign cert via CA utility, create server record in DB, return `agent_id` + signed cert + CA cert — `size: L` | `depends: T-4.1.2`
- [ ] **T-4.2.3** Implement `POST /agents/heartbeat` — update server `last_heartbeat`, `agent_version`, OS info, resource usage; build and return commands array (scan_now, update_agent, update_vulndb) based on current state — `size: M`
- [ ] **T-4.2.4** Implement `GET /agents/version` — return latest agent binary version + download URL for each platform (linux/amd64, linux/arm64) — `size: S`
- [ ] **T-4.2.5** Implement agent offline detection — BullMQ recurring job (every 1 minute) checks for servers with `last_heartbeat > 5 minutes ago` AND status=active, triggers notification job — `size: M` | `depends: T-1.4.1`
- [ ] **T-4.2.6** Write tests for registration flow, heartbeat processing, command generation, and offline detection — `size: M`

### Story 4.3: Finding Submission (Agent API)

Handle batch finding uploads from agents and code scanner.

**Acceptance Criteria:**
- Batch findings accepted, deduplicated, and stored
- Previously open findings not in new scan auto-resolve
- New critical/high findings trigger notifications
- Findings synced to Elasticsearch

**Tasks:**

- [ ] **T-4.3.1** Implement `POST /agents/findings` — accept batch finding payload per spec format (agent_id, scan_id, scan_type, findings array), Zod validate, create/update scan record — `size: L` | `depends: T-1.4.1, T-1.3.3`
- [ ] **T-4.3.2** Implement finding deduplication: for each finding, match by (CVE+asset) or (title+asset) for non-CVE findings — if open finding exists, update it; if a previously open finding for this asset+scan_type is not in the new batch, mark as resolved with `resolved_at = now()` — `size: L`
- [ ] **T-4.3.3** After ingestion, enqueue notification jobs for new critical/high findings; emit WebSocket events (`finding:new`, `scan:completed`) — `size: M` | `depends: T-1.4.1`
- [ ] **T-4.3.4** Write tests for batch ingestion, deduplication, auto-resolution, and notification triggering — `size: L`

---

## Epic 5: Vulnerability Database

### Story 5.1: CVE Data Pipeline

Fetch and store vulnerability data from public sources.

**Acceptance Criteria:**
- Vulnerability data synced from NVD, GitHub Advisory, OSV.dev
- Deduplication prefers NVD for CVSS, GitHub for affected ranges
- Sync runs hourly without manual intervention

**Tasks:**

- [ ] **T-5.1.1** Implement NVD sync job (`src/jobs/vuln-db-sync.ts`) — fetch new/modified CVEs from NVD API 2.0 (paginated, since last sync timestamp), upsert into `vulnerabilities` table — `size: L`
- [ ] **T-5.1.2** Implement GitHub Advisory DB sync — fetch package-specific advisories with affected version ranges via GitHub GraphQL API, merge into `vulnerability_affects` — `size: L`
- [ ] **T-5.1.3** Implement OSV.dev sync — fetch aggregated vulnerability data via OSV API, deduplicate against existing records — `size: M`
- [ ] **T-5.1.4** Implement deduplication logic: prefer NVD for CVSS scores and descriptions, GitHub Advisory for affected version ranges; merge rather than overwrite — `size: M`
- [ ] **T-5.1.5** Schedule sync as BullMQ recurring job (every 1 hour); record last sync timestamp per source to enable incremental fetching — `size: S` | `depends: T-1.4.1`
- [ ] **T-5.1.6** Write tests for each data source sync and deduplication (using recorded API response fixtures) — `size: L`

### Story 5.2: BoltDB Snapshot for Agents

Compile vulnerability data into agent-consumable format.

**Acceptance Criteria:**
- BoltDB snapshot generated from vulnerability_affects data
- Agents can check version and download delta or full snapshot
- Snapshot rebuilt automatically after each sync

**Tasks:**

- [ ] **T-5.2.1** Implement BoltDB snapshot builder (Go utility or Node script) — read from `vulnerability_affects`, group by `(ecosystem:os_version, package_name)`, write to BoltDB with bucket structure per spec — `size: L`
- [ ] **T-5.2.2** Implement `GET /agents/vulndb/version` — return latest snapshot timestamp — `size: S`
- [ ] **T-5.2.3** Implement `GET /agents/vulndb/download` — accept `since` param; serve delta (entries modified since) if delta <50% of total, otherwise serve full BoltDB file; gzip compressed — `size: M`
- [ ] **T-5.2.4** Trigger snapshot rebuild after every successful vuln DB sync job — `size: S` | `depends: T-5.1.5`
- [ ] **T-5.2.5** Write tests for snapshot generation, delta calculation, and download — `size: M`

---

## Epic 6: Code Scanning Engine (Go)

### Story 6.1: CLI Framework

Build the `sc-scan` command-line tool.

**Acceptance Criteria:**
- CLI parses all spec flags and config file
- Output works in table, JSON, and SARIF formats
- Exit codes match spec (0, 1, 2)

**Tasks:**

- [ ] **T-6.1.1** Implement CLI entrypoint (`cmd/sc-scan/main.go`) using cobra — parse all flags: `--path`, `--api-key`, `--api-url`, `--scan-deps`, `--scan-secrets`, `--output`, `--output-file`, `--fail-on`, `--incremental`, `--no-upload`, `--verbose` — `size: M`
- [ ] **T-6.1.2** Implement configuration file parser (`.securitycentral.yml`) — load from repo root, merge with CLI flags (CLI takes precedence) — `size: M`
- [ ] **T-6.1.3** Implement output formatters: `table` (human-readable), `json`, `sarif` (GitHub Code Scanning compatible) — `size: M`
- [ ] **T-6.1.4** Implement exit codes: 0 (clean or below threshold), 1 (findings at or above `--fail-on` severity), 2 (scan error) — `size: S`
- [ ] **T-6.1.5** Write tests for CLI flag parsing, config file merging, output formatting, and exit code logic — `size: M`

### Story 6.2: Dependency Scanning

Detect vulnerable dependencies from lockfiles.

**Acceptance Criteria:**
- npm, pip, and Maven lockfiles parsed correctly
- Vulnerable dependencies matched against local BoltDB
- Findings include CVE, versions, remediation, auto-fixable flag
- Ignore rules from config file applied

**Tasks:**

- [ ] **T-6.2.1** Implement lockfile discovery — walk repo, find lockfiles by filename pattern — `size: S`
- [ ] **T-6.2.2** Implement npm lockfile parser (`internal/scanner/deps/npm.go`) — parse `package-lock.json` (JSON), extract `(ecosystem, package_name, version)` tuples with direct/transitive distinction — `size: M`
- [ ] **T-6.2.3** Implement yarn.lock parser — parse yarn v1 format (custom text format), extract tuples — `size: M`
- [ ] **T-6.2.4** Implement pip lockfile parser (`internal/scanner/deps/pip.go`) — parse `requirements.txt` (pinned versions `pkg==1.2.3`) — `size: S`
- [ ] **T-6.2.5** Implement Maven parser (`internal/scanner/deps/maven.go`) — parse `pom.xml` for `groupId:artifactId:version` — `size: M`
- [ ] **T-6.2.6** Implement BoltDB reader (`internal/vulndb/reader.go`) — load local BoltDB, query by `(ecosystem, package_name)` — `size: M`
- [ ] **T-6.2.7** Implement vulnerability matching — for each tuple, query BoltDB, check if version falls within affected range (semver comparison for npm/pip, Maven version comparison) — `size: L`
- [ ] **T-6.2.8** Generate `Finding` structs with: CVE ID, CVSS, severity, installed/fixed versions, lockfile path, direct vs transitive, remediation text, auto_fixable flag — `size: M`
- [ ] **T-6.2.9** Implement `.securitycentral.yml` ignore/suppress rules — ignore specific CVEs (with optional expiry date), ignore packages below version threshold — `size: S`
- [ ] **T-6.2.10** Write unit tests for each lockfile parser with fixture files — `size: M`
- [ ] **T-6.2.11** Write integration test: scan a sample repo with known vulnerabilities in multiple ecosystems, verify correct findings produced — `size: M`

### Story 6.3: Secrets Detection

Scan code for hardcoded secrets.

**Acceptance Criteria:**
- 50 core patterns detect real secret formats
- Entropy filter reduces false positives on placeholder values
- Exclusions and allowlists work correctly
- Test fixtures and gitignored files skipped

**Tasks:**

- [ ] **T-6.3.1** Implement regex pattern engine (`internal/scanner/secrets/engine.go`) — load patterns from embedded config, scan file content line-by-line, return matches with file path + line number + matched pattern name — `size: M`
- [ ] **T-6.3.2** Implement cloud provider key patterns (10 patterns): AWS access key (`AKIA...`), AWS secret key, GCP API key (`AIza...`), GCP service account JSON, Azure storage key — `size: M`
- [ ] **T-6.3.3** Implement API token patterns (15 patterns): GitHub PAT, Slack token/webhook, Stripe keys (pk/sk), Twilio, SendGrid, Mailgun, Heroku, npm token, PyPI token — `size: M`
- [ ] **T-6.3.4** Implement private key / credential patterns (10 patterns): PEM-encoded RSA/EC private keys, database URIs (`postgres://`, `mysql://`, `mongodb://`) with credentials, JWT tokens — `size: M`
- [ ] **T-6.3.5** Implement generic high-entropy patterns (15 patterns): high-entropy strings near keywords (`password`, `secret`, `token`, `api_key`, `private_key`, `credential`) — `size: M`
- [ ] **T-6.3.6** Implement Shannon entropy filter — compute entropy of candidate string, only flag if entropy > 4.5 — `size: S`
- [ ] **T-6.3.7** Implement exclusion rules: skip files matching `.gitignore` patterns, test fixtures (`*_test.*`, `testdata/`, `fixtures/`), lockfiles, auto-generated files — `size: M`
- [ ] **T-6.3.8** Implement allowlist from `.securitycentral.yml` (allow by path glob, pattern regex, or specific string SHA-256 hash) — `size: S`
- [ ] **T-6.3.9** Write tests with sample files containing real pattern formats (sanitized) and verify detection, exclusion, and allowlist behavior — `size: M`

### Story 6.4: Incremental Scanning

Only scan changed files for faster CI runs.

**Acceptance Criteria:**
- `--incremental` flag scans only files changed since last commit on the branch
- Falls back to full scan if git history unavailable

**Tasks:**

- [ ] **T-6.4.1** Implement git diff detection — when `--incremental`, run `git diff --name-only HEAD~1` (or against base branch) to get changed file list — `size: M`
- [ ] **T-6.4.2** Filter lockfile discovery and secrets scanning to only changed files; still do full dependency match if any lockfile changed — `size: S`
- [ ] **T-6.4.3** Write tests for incremental mode with mock git state — `size: S`

### Story 6.5: Platform Upload

Submit scan results to the SecurityCentral platform.

**Acceptance Criteria:**
- Findings uploaded to platform via API
- `--no-upload` mode works for local-only scans
- Retries on transient failures

**Tasks:**

- [ ] **T-6.5.1** Implement platform client (`internal/platform/client.go`) — HTTPS client, authenticate with API key via `X-API-Key` header, submit findings batch to `POST /v1/agents/findings` — `size: M`
- [ ] **T-6.5.2** Implement `--no-upload` mode — skip platform submission, output results locally only — `size: S`
- [ ] **T-6.5.3** Implement retry with exponential backoff on upload failure (1s, 2s, 4s, ... up to 30s, max 5 attempts) — `size: S`
- [ ] **T-6.5.4** Write tests for platform client with mock HTTP server (success, retry, auth failure) — `size: M`

---

## Epic 7: Infrastructure Scanning Agent (Go)

### Story 7.1: Agent Installer

Provide one-line install for the infrastructure agent.

**Acceptance Criteria:**
- `curl | bash` installs agent on Ubuntu, CentOS, and Alpine
- Binary signature verified before installation
- Agent registered and running as systemd service after install

**Tasks:**

- [ ] **T-7.1.1** Create installer script (`scripts/install-agent.sh`) — detect platform (linux/amd64 vs arm64), download binary from release URL, verify ed25519 signature — `size: M`
- [ ] **T-7.1.2** Installer creates `/etc/securitycentral/agent.yml` config from CLI args (`--api-key`, `--api-url`, `--environment`, `--labels`) — `size: S`
- [ ] **T-7.1.3** Installer registers with platform (`POST /agents/register`) to receive `agent_id` and mTLS cert, saves certs to `/etc/securitycentral/` — `size: M` | `depends: T-4.2.2`
- [ ] **T-7.1.4** Installer creates systemd unit `securitycentral-agent.service`, enables and starts the service — `size: S`
- [ ] **T-7.1.5** Write tests for installer script (using Docker containers for each target OS) — `size: M`

### Story 7.2: Agent Lifecycle

Implement agent registration, heartbeat, and scan scheduling.

**Acceptance Criteria:**
- Agent starts, loads config, establishes mTLS connection
- Heartbeat sent every 60s with system metadata
- Scans run on startup and every 6h (configurable)
- Heartbeat commands (scan_now, update_vulndb) processed

**Tasks:**

- [ ] **T-7.2.1** Implement agent entrypoint (`cmd/sc-agent/main.go`) — load config from `/etc/securitycentral/agent.yml`, validate required fields — `size: M`
- [ ] **T-7.2.2** Implement registration flow (for manual/non-installer setup) — generate ECDSA P-256 key pair, create PKCS10 CSR, send `POST /agents/register` with API key + CSR, save signed cert + CA cert to disk — `size: M`
- [ ] **T-7.2.3** Implement mTLS client (`internal/platform/client.go`) — use agent cert + CA cert for all subsequent platform communication — `size: M`
- [ ] **T-7.2.4** Implement heartbeat loop — every 60 seconds, send system metadata (OS info from `/etc/os-release`, CPU/memory/disk from runtime, vulndb version, last scan time) to `POST /agents/heartbeat`; process command responses — `size: M`
- [ ] **T-7.2.5** Implement scan scheduler — run scan on startup (if `on_startup: true`) then every `scan.interval` (default 6h); support `scan_now` command from heartbeat to trigger immediate scan — `size: M`
- [ ] **T-7.2.6** Write tests for config loading, heartbeat, and scan scheduling — `size: M`

### Story 7.3: OS Package Scanning

Detect vulnerable packages on the host system.

**Acceptance Criteria:**
- Packages enumerated on Ubuntu, CentOS, and Alpine
- Vulnerable packages matched against local BoltDB
- Findings submitted to platform

**Tasks:**

- [ ] **T-7.3.1** Implement OS detection — read `/etc/os-release`, determine `os_family` (ubuntu/debian/centos/rhel/alpine) + version — `size: S`
- [ ] **T-7.3.2** Implement Ubuntu/Debian package enumerator — run `dpkg-query -W -f '...'`, parse tab-separated output into `(name, version, arch)` list — `size: M`
- [ ] **T-7.3.3** Implement CentOS/RHEL package enumerator — run `rpm -qa --queryformat '...'`, parse output — `size: M`
- [ ] **T-7.3.4** Implement Alpine package enumerator — parse `/lib/apk/db/installed` APK DB file — `size: M`
- [ ] **T-7.3.5** Implement vulnerability matching — for each `(os_family, os_version, package_name, version)`, query local BoltDB, compare version against affected ranges — `size: L` | `depends: T-6.2.6`
- [ ] **T-7.3.6** Generate findings and submit to platform via `POST /agents/findings` — `size: M` | `depends: T-7.2.3`
- [ ] **T-7.3.7** Write tests for each OS enumerator (fixture data) and vulnerability matching — `size: M`

### Story 7.4: CIS Benchmark Scanning (Ubuntu L1)

Implement CIS Ubuntu 22.04 Level 1 compliance checks (~80 checks, MVP scoped to ~40 highest-value).

**Acceptance Criteria:**
- Check interface implemented; each check is a self-contained function
- At least 40 checks passing on a test system
- Check results converted to findings and submitted

**Tasks:**

- [ ] **T-7.4.1** Define `Check` interface: `ID() string`, `Title() string`, `Level() int`, `Run(ctx) (CheckResult, error)` with `CheckResult{Pass bool, Details string, Fix string}`; implement check registry and runner — `size: M`
- [ ] **T-7.4.2** Implement filesystem checks (8 checks): cramfs/squashfs/udf disabled, /tmp separate partition, /tmp nodev/nosuid/noexec, sticky bit on world-writable dirs — `size: M`
- [ ] **T-7.4.3** Implement SSH server checks — PermitRootLogin (1.1), PermitEmptyPasswords (1.2), MaxAuthTries (1.3), Protocol 2 (1.4), X11Forwarding (1.5) — `size: M`
- [ ] **T-7.4.4** Implement SSH cipher/MAC/KEX checks — approved ciphers only (2.1), approved MACs only (2.2), approved KEX algorithms only (2.3), LogLevel INFO (2.4) — `size: M`
- [ ] **T-7.4.5** Implement SSH access checks — LoginGraceTime (3.1), ClientAliveInterval/CountMax (3.2), IgnoreRhosts (3.3), HostbasedAuth disabled (3.4), Banner set (3.5) — `size: M`
- [ ] **T-7.4.6** Implement user/group checks (8 checks): password max days, password min days, password warn age, inactive lock, default umask, root is only UID-0, no duplicate UIDs/GIDs — `size: M`
- [ ] **T-7.4.7** Implement network checks (6 checks): IP forwarding disabled, ICMP redirects disabled, source routed packets rejected, TCP SYN cookies enabled, IPv6 router advertisements — `size: M`
- [ ] **T-7.4.8** Implement process hardening checks (5 checks): ASLR enabled, core dump restricted, ptrace_scope set, SUID dumpable disabled, address space randomization — `size: M`
- [ ] **T-7.4.9** Implement check runner — execute all registered checks, convert `CheckResult` to findings (failed checks become findings with remediation=Fix), submit to platform as `scan_type: infra_compliance` — `size: M`
- [ ] **T-7.4.10** Write tests for each check category using mock system files and command outputs — `size: L`

### Story 7.5: Offline Queue & Retry

Handle network failures gracefully.

**Acceptance Criteria:**
- Findings stored locally when platform unreachable
- Queue drains in FIFO order on reconnect
- Queue bounded to 100 entries

**Tasks:**

- [ ] **T-7.5.1** Implement local finding queue — store findings as JSON files in `/var/lib/securitycentral/queue/` when platform POST fails — `size: M`
- [ ] **T-7.5.2** Implement exponential backoff retry: 1s, 2s, 4s, 8s, ... up to 5 minutes — `size: S`
- [ ] **T-7.5.3** Implement queue drain on reconnect — on next successful heartbeat, submit queued findings in FIFO order — `size: M`
- [ ] **T-7.5.4** Enforce queue limit: 100 scan results max, drop oldest when exceeded — `size: S`
- [ ] **T-7.5.5** Write tests for offline queueing, backoff, and reconnect drain — `size: M`

### Story 7.6: Vuln DB Updates & Self-Update

Keep agent and vulnerability database current.

**Acceptance Criteria:**
- Vuln DB delta downloaded and applied on command
- Agent binary self-updates with signature verification

**Tasks:**

- [ ] **T-7.6.1** Implement vuln DB auto-update — on heartbeat response `update_vulndb` command, fetch delta from `GET /agents/vulndb/download`, apply to local BoltDB — `size: M` | `depends: T-5.2.3`
- [ ] **T-7.6.2** Implement agent self-update — on heartbeat response `update_agent` command, download new binary from URL in command, verify ed25519 signature, replace binary, restart systemd service — `size: L`
- [ ] **T-7.6.3** Write tests for vuln DB delta application and binary update with signature verification — `size: M`

### Story 7.7: Resource Constraints

Ensure the agent is lightweight per spec requirements (<1% CPU, <10MB RAM, <5MB binary).

**Acceptance Criteria:**
- Agent meets all resource targets under load
- Log rotation prevents disk growth

**Tasks:**

- [ ] **T-7.7.1** Set `GOMAXPROCS(1)` and run with `nice 19` for process priority — `size: S`
- [ ] **T-7.7.2** Use pre-allocated buffers and streaming parsers to stay under 10MB resident memory — `size: M`
- [ ] **T-7.7.3** Implement log rotation: 5MB × 3 files in `/var/log/securitycentral/` — `size: S`
- [ ] **T-7.7.4** Enable gzip compression for all platform API requests — `size: S`
- [ ] **T-7.7.5** Write benchmark tests verifying CPU (<1% avg, 5% burst) and memory (<10MB) during a full scan — `size: M`

---

## Epic 8: Certificate Monitoring Engine (Go)

### Story 8.1: AWS Certificate Discovery

Discover certificates from AWS load balancers and ACM.

**Acceptance Criteria:**
- All ALBs/NLBs discovered and their HTTPS listener certs extracted
- Certificate details fetched from ACM and submitted to platform

**Tasks:**

- [ ] **T-8.1.1** Implement certmon entrypoint (`cmd/sc-certmon/main.go`) — built-in scheduler (every 1 hour) or one-shot mode, load AWS credentials from environment/instance role — `size: M`
- [ ] **T-8.1.2** Implement ALB/NLB discovery — list all load balancers via `elbv2:DescribeLoadBalancers`, list listeners, extract certificate ARNs from HTTPS listeners — `size: M`
- [ ] **T-8.1.3** Implement ACM certificate fetch — for each certificate ARN, call `acm:DescribeCertificate`, extract subject, SANs, expiry, issuer, key algorithm, signature algorithm — `size: M`
- [ ] **T-8.1.4** Convert discovered certificates to platform Certificate model, submit via `POST /agents/findings` (scan_type: cert_discovery) — `size: M` | `depends: T-4.3.1`
- [ ] **T-8.1.5** Write tests with mocked AWS SDK responses — `size: M`

### Story 8.2: Direct TLS Probe

Discover certificates by connecting directly to endpoints.

**Acceptance Criteria:**
- TLS probe extracts leaf cert + full chain
- Batch probe handles concurrent connections with timeout

**Tasks:**

- [ ] **T-8.2.1** Implement TLS probe (`internal/certdiscovery/probe.go`) — connect to `host:port` via `tls.DialWithDialer`, extract leaf certificate + full chain; 10s timeout — `size: M`
- [ ] **T-8.2.2** Implement batch probe — accept list of endpoints (from LB targets or user config), probe concurrently (max 20 goroutines), collect results — `size: M`
- [ ] **T-8.2.3** Write tests with local TLS test server (generate self-signed and chain certs for testing) — `size: M`

### Story 8.3: Certificate Health Checks

Evaluate certificate health and generate findings.

**Acceptance Criteria:**
- All check types from spec implemented with correct severity levels
- Findings submitted to platform with appropriate detail

**Tasks:**

- [ ] **T-8.3.1** Implement expiry checks per spec: expired=critical, ≤7d=critical, ≤30d=high, ≤60d=medium, ≤90d=low — `size: M`
- [ ] **T-8.3.2** Implement key strength check — RSA <2048 bits = high — `size: S`
- [ ] **T-8.3.3** Implement signature algorithm check — SHA-1 signature = high — `size: S`
- [ ] **T-8.3.4** Implement self-signed detection — `issuer == subject` and not in trusted roots = medium — `size: S`
- [ ] **T-8.3.5** Implement chain validation — verify full chain from leaf to trusted root, incomplete chain = medium — `size: M`
- [ ] **T-8.3.6** Implement wildcard advisory — `*.example.com` on public endpoint = info — `size: S`
- [ ] **T-8.3.7** Generate findings for all failed checks, submit to platform via `POST /agents/findings` (scan_type: cert_check) — `size: M`
- [ ] **T-8.3.8** Write tests for each check type with sample certificates (expired, weak key, self-signed, broken chain) — `size: M`

### Story 8.4: Alert Deduplication

Avoid re-alerting for the same certificate at the same threshold.

**Acceptance Criteria:**
- Same cert + same threshold only alerts once
- Crossing a new threshold (e.g., 30d → 7d) triggers new alert

**Tasks:**

- [ ] **T-8.4.1** Before sending notification, check `cert_alerts` table for existing `(certificate_id, alert_type)` unique pair — `size: S`
- [ ] **T-8.4.2** Only create notification job if no prior alert exists for that threshold; insert new alert record on send — `size: S`
- [ ] **T-8.4.3** Write tests for deduplication (same threshold suppressed, new threshold allowed) — `size: S`

---

## Epic 9: Integrations

### Story 9.1: GitHub Integration

Connect to GitHub for repo discovery, webhooks, and PR creation.

**Acceptance Criteria:**
- GitHub App installed via OAuth flow
- Push events trigger code scans
- Installation events auto-discover repos
- Auto-fix PRs created for fixable vulnerabilities

**Tasks:**

- [ ] **T-9.1.1** Create integrations module: `src/modules/integrations/integrations.router.ts`, `integrations.service.ts` — `size: S`
- [ ] **T-9.1.2** Implement `POST /integrations/github` — initiate GitHub App OAuth flow, on callback store `installation_id` + `app_id` in integrations table (config encrypted at rest) — `size: M`
- [ ] **T-9.1.3** Implement `POST /integrations/github/webhook` — receive events, verify HMAC signature with `GITHUB_WEBHOOK_SECRET` — `size: M`
- [ ] **T-9.1.4** Handle push event: look up repository by provider_id, enqueue `scan-orchestration` job — `size: S` | `depends: T-1.4.1`
- [ ] **T-9.1.5** Handle installation event: auto-discover and register all repositories in the installation — `size: M`
- [ ] **T-9.1.6** Implement GitHub API client (`src/lib/github.ts`) — authenticate as GitHub App (JWT + installation token), create branches, commit file changes, open PRs — `size: L`
- [ ] **T-9.1.7** Implement `github-pr-creator` BullMQ job — for each auto-fixable finding: compute minimum version bump, create branch `securitycentral/fix-<cve_id>-<timestamp>`, update lockfile, open PR with title `fix(security): upgrade <package> to <version> (CVE-XXXX-YYYY)` and body with severity/CVE details/changelog link, record `fix_pr_url` on finding — `size: XL` | `depends: T-9.1.6`
- [ ] **T-9.1.8** Write tests for webhook handling, repo discovery, and PR creation (mocked GitHub API) — `size: L`

### Story 9.2: GitLab Integration

Connect to GitLab for repo discovery and webhooks.

**Acceptance Criteria:**
- GitLab connected via access token
- Push events trigger code scans

**Tasks:**

- [ ] **T-9.2.1** Implement `POST /integrations/gitlab` — accept access token, store encrypted in integrations table — `size: S`
- [ ] **T-9.2.2** Implement `POST /integrations/gitlab/webhook` — receive push events, verify webhook token, trigger code scan for repo — `size: M`
- [ ] **T-9.2.3** Write tests for GitLab webhook handling — `size: S`

### Story 9.3: Slack Integration

Send security notifications to Slack.

**Acceptance Criteria:**
- Webhook URL stored encrypted
- Messages formatted with Slack Block Kit per spec templates
- All four notification types (critical finding, scan complete, cert expiry, agent offline) working

**Tasks:**

- [ ] **T-9.3.1** Implement `POST /integrations/slack` — accept webhook URL, store encrypted in integrations table — `size: S`
- [ ] **T-9.3.2** Implement Slack notification sender (`src/lib/slack.ts`) — post to webhook URL with Slack Block Kit formatted payload — `size: M`
- [ ] **T-9.3.3** Create message templates per spec: critical finding (CVE, severity, package, asset, "View Finding" button), scan completed (summary counts), certificate expiring (subject, days remaining), agent offline (hostname, last seen) — `size: M`
- [ ] **T-9.3.4** Write tests for message formatting and webhook posting (mock webhook endpoint) — `size: M`

### Story 9.4: Integration Management

List and remove integrations.

**Acceptance Criteria:**
- All integrations listable with status
- Integrations removable by admin/owner

**Tasks:**

- [ ] **T-9.4.1** Implement `GET /integrations` — list configured integrations for org (provider, status, created_at) — `size: S`
- [ ] **T-9.4.2** Implement `DELETE /integrations/:id` — remove integration, clean up webhooks if applicable — `size: S`
- [ ] **T-9.4.3** Write tests for list and delete — `size: S`

---

## Epic 10: Notification System

### Story 10.1: Notification Dispatcher

Central notification routing and preferences.

**Acceptance Criteria:**
- Notification job routes events to correct channels based on user preferences
- Default: all critical finding + agent offline notifications enabled for all users
- Users can toggle notifications per channel per event type

**Tasks:**

- [ ] **T-10.1.1** Implement `notification-dispatcher` BullMQ job — receive event (type: critical_finding | scan_complete | cert_expiry | agent_offline, payload), load org's notification preferences, route to Slack and/or email — `size: M` | `depends: T-9.3.2`
- [ ] **T-10.1.2** Implement default notification preferences — on org creation, create default preferences (all channels enabled for critical_finding and agent_offline) — `size: S`
- [ ] **T-10.1.3** Implement notification preferences API — `GET /notification-preferences` (list for current user), `PUT /notification-preferences` (bulk update channel+event_type toggles) — `size: M`
- [ ] **T-10.1.4** Write tests for notification routing, preference filtering, and default creation — `size: M`

### Story 10.2: Email Notifications

Daily digest email via AWS SES.

**Acceptance Criteria:**
- Daily digest sent at configured time
- Email includes new findings summary, expiring certs, offline agents
- Respects per-user email preference toggles

**Tasks:**

- [ ] **T-10.2.1** Implement daily digest BullMQ recurring job — aggregate new findings by severity, expiring certs, offline agents for the past 24h, per org — `size: M`
- [ ] **T-10.2.2** Implement HTML email template for digest (responsive, includes severity color coding) — `size: M`
- [ ] **T-10.2.3** Send via AWS SES using `SES_FROM_EMAIL` config; skip users with email notifications disabled — `size: S`
- [ ] **T-10.2.4** Write tests for digest aggregation, template rendering, and preference filtering — `size: M`

---

## Epic 11: Real-Time Updates (WebSocket)

### Story 11.1: WebSocket Server

Live dashboard updates via Socket.IO.

**Acceptance Criteria:**
- WebSocket connections authenticated via JWT
- Events scoped to org rooms (no cross-org leakage)
- Multi-instance fan-out via Redis pub/sub
- All seven event types from spec emitted correctly

**Tasks:**

- [ ] **T-11.1.1** Set up Socket.IO server in `platform-api/src/ws/` — authenticate connections via JWT in handshake, join org-scoped room — `size: M`
- [ ] **T-11.1.2** Implement Redis pub/sub adapter for Socket.IO — enable fan-out across multiple ECS tasks — `size: M`
- [ ] **T-11.1.3** Implement event emission functions for: `finding:new`, `finding:resolved`, `scan:started`, `scan:completed`, `agent:connected`, `agent:disconnected`, `cert:expiring` — emit to org room with payload per spec — `size: M`
- [ ] **T-11.1.4** Connect event emission to BullMQ job hooks — emit after finding ingestion, scan completion, heartbeat processing, cert check — `size: M` | `depends: T-4.3.3, T-4.2.3`
- [ ] **T-11.1.5** Write tests for WebSocket authentication, org-scoping, and event delivery — `size: M`

---

## Epic 12: Web Dashboard (React)

### Story 12.1: API Client & WebSocket Client

Typed API client — prerequisite for all dashboard pages.

**Acceptance Criteria:**
- API client handles JWT auth, auto-refresh, typed responses
- WebSocket client connects with JWT, auto-reconnects
- All endpoints have typed hooks

**Tasks:**

- [ ] **T-12.1.1** Implement API client (`src/api/client.ts`) — fetch wrapper with JWT auth (Authorization header), auto-refresh on 401 via `/auth/refresh`, typed error handling using envelope format — `size: M`
- [ ] **T-12.1.2** Implement API hooks using React Query or SWR: `useFindings`, `useServers`, `useRepositories`, `useCertificates`, `useScans`, `useDashboardSummary`, `useDashboardTopRisks`, `useDashboardAssets`, `useFindingsTrends` — `size: L`
- [ ] **T-12.1.3** Implement WebSocket client (`src/ws/client.ts`) — Socket.IO connection with JWT auth in handshake, event handlers, auto-reconnect with backoff — `size: M`

### Story 12.2: App Shell & Auth

Dashboard layout, routing, and authentication.

**Acceptance Criteria:**
- Users can register, login, and access protected pages
- Auth state persisted across page refreshes via refresh token
- Unauthenticated users redirected to login

**Tasks:**

- [ ] **T-12.2.1** Set up routing (React Router): `/login`, `/register`, `/dashboard`, `/findings`, `/findings/:id`, `/assets/repositories`, `/assets/servers`, `/assets/certificates`, `/scans`, `/integrations`, `/settings` — `size: M`
- [ ] **T-12.2.2** Implement login page — email/password form, call `POST /auth/login`, store access token in memory — `size: M` | `depends: T-12.1.1`
- [ ] **T-12.2.3** Implement registration page — org name + admin user details form, call `POST /auth/register` — `size: M`
- [ ] **T-12.2.4** Implement auth context/provider — manage JWT lifecycle, auto-refresh before expiry, redirect to login on 401, persist auth state — `size: M`
- [ ] **T-12.2.5** Implement protected route wrapper — redirect unauthenticated users to `/login` — `size: S`
- [ ] **T-12.2.6** Implement app shell layout — sidebar navigation (Dashboard, Findings, Assets, Scans, Integrations, Settings), header with org name + user menu + logout — `size: M`

### Story 12.3: Dashboard Overview Page

Main dashboard with summary widgets.

**Acceptance Criteria:**
- Page loads in <2s with summary, top risks, asset overview, trends
- Widgets update in real-time via WebSocket

**Tasks:**

- [ ] **T-12.3.1** Implement severity breakdown widget — fetch `GET /dashboard/summary`, display counts for critical/high/medium/low as color-coded cards or donut chart — `size: M` | `depends: T-12.1.2`
- [ ] **T-12.3.2** Implement top risks widget — fetch `GET /dashboard/top-risks`, display table of top 10 findings (severity badge, title, asset, CVE, link to detail) — `size: M`
- [ ] **T-12.3.3** Implement assets overview widget — fetch `GET /dashboard/assets-overview`, display repo/server/cert counts with health indicators — `size: M`
- [ ] **T-12.3.4** Implement trends chart — fetch `GET /findings/trends`, display line chart (new vs resolved) using a charting library (Recharts or Chart.js) — `size: M`
- [ ] **T-12.3.5** Connect WebSocket — subscribe to org events, update summary counts on `finding:new`, refresh top risks on `scan:completed` — `size: M` | `depends: T-12.1.3`

### Story 12.4: Findings Pages

Filterable findings list and detail view.

**Acceptance Criteria:**
- Findings list paginated, sortable, and filterable by all spec params
- Detail page shows full finding info with status update actions
- Status changes reflected immediately in the list

**Tasks:**

- [ ] **T-12.4.1** Implement findings list page — table with columns: severity (color badge), title, source, asset, CVE, status, first seen. Paginated (page/per_page controls), sortable (column headers) — `size: L`
- [ ] **T-12.4.2** Implement filter bar — dropdowns/chips for severity, status, source; text search input for CVE/title (uses `q` param); applied filters shown as removable chips — `size: M`
- [ ] **T-12.4.3** Implement finding detail page — CVE ID, CVSS score + vector visualization, description, remediation text, affected asset (link), fix PR URL (link), scan info, timeline (first_seen, resolved_at) — `size: M`
- [ ] **T-12.4.4** Implement status update actions — buttons to mark as in_progress/resolved/suppressed/false_positive, call `PATCH /findings/:id`, optimistic update in UI — `size: M`

### Story 12.5: Assets Pages

Browse repositories, servers, and certificates.

**Acceptance Criteria:**
- Each asset type has list + detail pages
- Detail pages show related findings and scan info
- Trigger Scan button works for repositories

**Tasks:**

- [ ] **T-12.5.1** Implement repositories list page — table with name, provider icon, language, last scan date, finding counts by severity (color-coded badges) — `size: M`
- [ ] **T-12.5.2** Implement repository detail page — latest scan info, "Trigger Scan" button (calls `POST /repositories/:id/scan`), findings list filtered to this repo — `size: M`
- [ ] **T-12.5.3** Implement servers list page — table with hostname, OS, environment badge, status indicator (online/offline based on heartbeat), last heartbeat relative time, finding counts — `size: M`
- [ ] **T-12.5.4** Implement server detail page — system info card (OS, arch, cloud, agent version), resource usage, findings list, agent status — `size: M`
- [ ] **T-12.5.5** Implement certificates list page — table with subject CN, issuer, expiry date (color-coded: green >90d, yellow 30–90d, red <30d), status, algorithm — `size: M`
- [ ] **T-12.5.6** Implement certificate detail page — chain visualization, SANs list, algorithm strength, related findings — `size: M`

### Story 12.6: Scans Page

View scan history and trigger manual scans.

**Acceptance Criteria:**
- Scans listed with type, status, asset, timing, findings summary
- In-progress scans show progress indicator
- Failed scans show error message

**Tasks:**

- [ ] **T-12.6.1** Implement scans list page — table with type icon, status badge (pending/running/completed/failed), asset name, trigger, started/completed time, findings counts (total/new/resolved) — `size: M`
- [ ] **T-12.6.2** Implement scan detail page — progress indicator for running scans, findings breakdown, error message if failed, duration — `size: M`

### Story 12.7: Integrations Page

Configure GitHub, GitLab, and Slack connections.

**Acceptance Criteria:**
- Integration status visible at a glance
- Each provider has appropriate connection flow
- Disconnect removes integration

**Tasks:**

- [ ] **T-12.7.1** Implement integrations page — cards for GitHub, GitLab, Slack showing connection status (connected/disconnected), connected date — `size: M`
- [ ] **T-12.7.2** Implement GitHub connection flow — "Connect GitHub" button → redirect to GitHub App install → callback handling → refresh status — `size: M`
- [ ] **T-12.7.3** Implement GitLab connection flow — modal: input access token, save, test connection — `size: S`
- [ ] **T-12.7.4** Implement Slack connection flow — modal: input webhook URL, "Test" button sends test message, save — `size: S`
- [ ] **T-12.7.5** Implement disconnect button — confirm dialog, call `DELETE /integrations/:id`, refresh status — `size: S`

### Story 12.8: Settings Page

Organization settings, API keys, and notification preferences.

**Acceptance Criteria:**
- Org info displayed
- API keys manageable (create shows key once, list, revoke)
- Notification preferences toggleable per channel per event type

**Tasks:**

- [ ] **T-12.8.1** Implement org settings section — display org name, plan, member count — `size: S`
- [ ] **T-12.8.2** Implement API keys management — list keys (prefix, name, scopes, last used), "Create API Key" form (name, scopes checkboxes) with modal showing raw key once, revoke button with confirm — `size: L`
- [ ] **T-12.8.3** Implement notification preferences — grid of toggles: rows = event types (critical finding, scan complete, cert expiry, agent offline), columns = channels (Slack, email); call `PUT /notification-preferences` on change — `size: M`

---

## Epic 13: Deployment & Infrastructure as Code

### Story 13.1: AWS Infrastructure (Terraform)

Provision MVP infrastructure on AWS.

**Acceptance Criteria:**
- `terraform apply` creates complete infrastructure
- All services reachable and healthy
- Secrets stored in AWS Secrets Manager

**Tasks:**

- [ ] **T-13.1.1** Create Terraform project structure: `infra/terraform/` with modules for VPC, ECS, RDS, ElastiCache, OpenSearch, S3, CloudFront, ALB — `size: M`
- [ ] **T-13.1.2** Define VPC: public + private subnets across 2 AZs, NAT gateway, security groups (API ALB, ECS tasks, RDS, Redis, OpenSearch) — `size: L`
- [ ] **T-13.1.3** Define RDS PostgreSQL 16: `db.r6g.large`, Multi-AZ, 100GB gp3 (autoscale to 500GB), 7-day backup, AES-256 encryption — `size: M`
- [ ] **T-13.1.4** Define ElastiCache Redis 7: `cache.r6g.large`, AOF persistence, encryption in transit — `size: M`
- [ ] **T-13.1.5** Define OpenSearch: `t3.medium.search` × 2 nodes, 100GB per node, encryption — `size: M`
- [ ] **T-13.1.6** Define ECS Fargate cluster: Platform API service (2–10 tasks, CPU 60% autoscale, 1 vCPU/2GB), Workers service (2–5 tasks, queue depth autoscale, 1 vCPU/2GB) — `size: L`
- [ ] **T-13.1.7** Define ALB for Platform API with HTTPS listener, health check `GET /health`, target group for ECS — `size: M`
- [ ] **T-13.1.8** Define S3 bucket + CloudFront distribution for dashboard SPA (OAI, custom domain, HTTPS) — `size: M`
- [ ] **T-13.1.9** Define ECS Scheduled Task for Cert Monitor (hourly, 0.5 vCPU/512MB) — `size: S`
- [ ] **T-13.1.10** Define ECR repositories for platform-api and certmon images — `size: S`
- [ ] **T-13.1.11** Define AWS Secrets Manager entries: DATABASE_URL, REDIS_URL, JWT_SECRET, JWT_REFRESH_SECRET, AGENT_CA_CERT, AGENT_CA_KEY, GITHUB_APP_PRIVATE_KEY — `size: S`
- [ ] **T-13.1.12** Define IAM roles: ECS task execution role, ECS task role (Secrets Manager access), Cert Monitor role (ELB/ACM read), CI/CD deploy role (ECR push, ECS deploy, S3 sync) — `size: M`

### Story 13.2: Docker & Container Setup

Containerize all services.

**Acceptance Criteria:**
- All Dockerfiles build successfully
- Docker Compose mirrors production topology for local dev
- Images optimized (multi-stage, minimal base)

**Tasks:**

- [ ] **T-13.2.1** Create `Dockerfile` for platform-api — multi-stage: install deps + build TypeScript → production Node.js alpine image, non-root user — `size: M`
- [ ] **T-13.2.2** Create `Dockerfile` for dashboard — multi-stage: build React → nginx alpine serving static files — `size: S`
- [ ] **T-13.2.3** Create `Dockerfile` for cert monitor — multi-stage: build Go binary → scratch/distroless image — `size: S`
- [ ] **T-13.2.4** Update Docker Compose for local dev — all services (api, worker, dashboard, postgres, redis, opensearch) with correct env vars, port mappings, and health checks — `size: M`

---

## Epic 14: Metrics & Health Checks

### Story 14.1: Application Metrics

Prometheus-compatible metrics for all services.

**Acceptance Criteria:**
- `/metrics` endpoint returns Prometheus-format metrics
- All spec metrics exposed
- Health endpoint checks all dependencies

**Tasks:**

- [ ] **T-14.1.1** Implement `GET /health` endpoint — check DB, Redis, and ES connectivity, return `{ status: "ok"|"degraded"|"down", checks: {...} }` — `size: M`
- [ ] **T-14.1.2** Expose Prometheus metrics: `http_request_duration_seconds` (histogram by route/method/status), `http_requests_total` (counter), `ws_connections_active` (gauge), `bullmq_queue_depth` (gauge by queue), `bullmq_job_duration_seconds` (histogram by queue) — `size: L`
- [ ] **T-14.1.3** Expose business metrics: `findings_open` (gauge by org/severity/source), `findings_mttr_seconds` (histogram), `scans_completed_total` (counter by type/trigger) — `size: M`
- [ ] **T-14.1.4** Expose agent metrics: `agents_active` (gauge by os_family/environment), `agent_heartbeats_total` (counter), `findings_ingested_total` (counter by source/severity) — `size: M`

---

## Epic 15: Data Retention

### Story 15.1: Cleanup Jobs

Implement data retention policies per spec.

**Acceptance Criteria:**
- Resolved findings older than 1 year deleted (or archived)
- Heartbeat records older than 30 days deleted
- Scan records older than 1 year deleted
- Jobs run on schedule without manual intervention

**Tasks:**

- [ ] **T-15.1.1** Implement retention cleanup BullMQ recurring job (daily at 3 AM) — delete resolved findings older than 1 year, delete heartbeat records older than 30 days, delete scan records older than 1 year — `size: M`
- [ ] **T-15.1.2** Also delete corresponding ES documents for removed findings — `size: S` | `depends: T-1.3.2`
- [ ] **T-15.1.3** Log cleanup metrics (records deleted per type) for observability — `size: S`
- [ ] **T-15.1.4** Write tests for retention logic (verify correct records kept/deleted based on dates) — `size: M`

---

## Task Summary

| Epic | Stories | Tasks |
|------|---------|-------|
| 1. Foundation & Infrastructure | 7 | 33 |
| 2. Authentication & Authorization | 3 | 16 |
| 3. Platform API — Core Modules | 7 | 33 |
| 4. Agent Communication | 3 | 15 |
| 5. Vulnerability Database | 2 | 11 |
| 6. Code Scanning Engine | 5 | 28 |
| 7. Infrastructure Scanning Agent | 7 | 33 |
| 8. Certificate Monitoring | 4 | 16 |
| 9. Integrations | 4 | 14 |
| 10. Notification System | 2 | 8 |
| 11. Real-Time Updates | 1 | 5 |
| 12. Web Dashboard | 8 | 30 |
| 13. Deployment & IaC | 2 | 16 |
| 14. Metrics & Health Checks | 1 | 4 |
| 15. Data Retention | 1 | 4 |
| **Total** | **52** | **266** |

---

## Dependency Graph (Critical Path)

```
Epic 1 (Foundation)
  ├── T-1.1.5 (Docker Compose) ──► T-1.3.1 (ES index) ──► T-1.3.3 (ES sync)
  ├── T-1.2.7 (DB migration) ──► T-2.1.3 (Register) ──► T-2.1.6 (Auth middleware)
  ├── T-1.4.1 (BullMQ queues) ──► T-4.3.1 (Finding submission)
  └── T-1.5.1 (Error handling) ──► All API routes

Epic 2 (Auth) ──► Epic 3 (Core API) ──► Epic 12 (Dashboard)

Epic 4 (Agent Comm)
  ├── T-4.2.2 (Register endpoint) ──► T-7.1.3 (Installer registers)
  └── T-4.3.1 (Finding submission) ──► T-7.3.6 (Agent submits findings)
                                   ──► T-8.1.4 (Certmon submits findings)

Epic 5 (VulnDB)
  └── T-5.2.3 (Download endpoint) ──► T-6.2.6 (Code scanner reads BoltDB)
                                   ──► T-7.3.5 (Agent reads BoltDB)

Epic 9 (Integrations) ──► T-9.3.2 (Slack sender) ──► T-10.1.1 (Notification dispatcher)
```

---

## Suggested Build Order

### Phase 1A — Foundation (Weeks 1–3)
**Team: Full stack**
- Epic 1 (all stories): scaffolding, DB schema, ES, BullMQ, middleware, logging, CI/CD
- Epic 2: auth, API keys, RBAC

### Phase 1B — Core API + Agent Communication (Weeks 4–7)
**Team: Backend**
- Epic 3: findings, assets, scans, dashboard, audit trail
- Epic 4: mTLS, agent registration/heartbeat, finding submission
- Epic 5: vuln DB pipeline + BoltDB snapshot

### Phase 1C — Scanning Engines (Weeks 5–12, parallel)
**Team: Go engineers (starts once VulnDB schema exists from 1B)**
- Epic 6: code scanner CLI, dependency scanning, secrets detection, platform upload
- Epic 7: agent installer, lifecycle, OS scanning, CIS benchmarks, offline queue, self-update
- Epic 8: cert monitor, AWS discovery, TLS probe, health checks

### Phase 1D — Integrations & Notifications (Weeks 8–12)
**Team: Backend**
- Epic 9: GitHub, GitLab, Slack integrations, auto-fix PRs
- Epic 10: notification dispatcher, email digest
- Epic 11: WebSocket server

### Phase 1E — Dashboard (Weeks 5–14, parallel)
**Team: Frontend (starts once auth + findings API available from 1A/1B)**
- Story 12.1 first (API client) — then all other dashboard stories in parallel tracks
- Epic 12: all pages

### Phase 1F — Ship (Weeks 13–16)
**Team: Full stack + DevOps**
- Epic 13: Terraform, Docker, deployment
- Epic 14: metrics, health checks
- Epic 15: data retention
- End-to-end testing, load testing, security audit
