# SecurityCentral — Onboarding Stories & Tasks

> Organized by Epic → Story → Task. Each task is independently actionable.
> Scope: Onboarding & Resource Discovery (Post-MVP, ~7 weeks)
>
> **Conventions:**
> - `depends: T-X.Y.Z` = must complete before this task starts
> - `size: S/M/L/XL` = relative effort (S=hours, M=1–2 days, L=3–5 days, XL=1–2 weeks)
> - Each story has **Acceptance Criteria** — the story is done when all AC are met
> - References: `ONBOARDING-SPEC.md` (spec), `ONBOARDING-PLAN.md` (plan)

---

## Epic 16: Onboarding — Repository Selection

### Story 16.1: GitLab API Client

Build a reusable GitLab API client for repo discovery and webhook management.

**Acceptance Criteria:**
- GitLab projects listable with pagination (handles `X-Next-Page` headers)
- Webhooks can be created and deleted on GitLab projects
- Self-hosted GitLab instances supported via custom base URL
- SSL verification configurable for self-signed certs

**Tasks:**

- [x] **T-16.1.1** Implement GitLab API client (`platform-api/src/lib/gitlab.ts`) — constructor takes `accessToken` + optional `baseUrl` (default `https://gitlab.com`); methods: `listProjects(query)` with pagination, `getProject(id)`, `createWebhook(projectId, url, token)`, `deleteWebhook(projectId, hookId)` — `size: M`
- [x] **T-16.1.2** Add self-hosted base URL + `verifySsl` support to GitLab integration — extend `createGitLabIntegration` in `integrations.service.ts` to accept optional `baseUrl` and `verifySsl`, store in config JSONB — `size: S`
- [x] **T-16.1.3** Add pagination support to `GitHubClient.listRepositories` — follow GitHub `Link` header pagination to fetch all repos (orgs with >30 repos currently only see first page) — `size: S`
- [x] **T-16.1.4** Write unit tests for GitLab client — test `listProjects`, multi-page pagination, self-hosted base URL, error cases; mock `fetch` — `size: S`
- [x] **T-16.1.5** Write unit tests for GitHub pagination fix — test multi-page `Link` header following — `size: S`

### Story 16.2: Repository Discovery API

Endpoints to discover repos from connected providers and sync selected ones.

**Acceptance Criteria:**
- `GET /integrations/github/repos` returns all accessible repos with `synced` boolean
- `GET /integrations/gitlab/repos` returns all accessible projects with `synced` boolean
- Repos searchable by name, paginated
- `POST .../repos/sync` creates repo records and configures webhooks
- `DELETE .../repos/:id/sync` removes webhook, preserves historical data

**Tasks:**

- [x] **T-16.2.1** Implement GitHub repo discovery — add `listGitHubRepos(orgId, { search?, page, per_page })` to integrations service; fetch from GitHub API via `GitHubClient.forInstallation()`, cross-reference with `repositories` table to annotate `synced: boolean` per repo — `size: M` | `depends: T-16.1.3`
- [x] **T-16.2.2** Implement GitLab repo discovery — add `listGitLabRepos(orgId, { search?, page, per_page })` to integrations service; use `GitLabClient` with stored token and base URL — `size: M` | `depends: T-16.1.1`
- [x] **T-16.2.3** Implement GitHub repo sync — add `syncGitHubRepos(orgId, repoIds[])`: for each repo, fetch details from GitHub API, upsert into `repositories` table, configure webhook; return created/updated repos — `size: M` | `depends: T-16.2.1`
- [x] **T-16.2.4** Implement GitHub repo unsync — add `unsyncGitHubRepo(orgId, repoProviderId)`: remove webhook, mark repo as archived (do NOT delete — preserve historical findings for compliance) — `size: S` | `depends: T-16.2.3`
- [x] **T-16.2.5** Implement GitLab repo sync + unsync — mirror GitHub pattern using `GitLabClient.createWebhook()` / `deleteWebhook()` — `size: M` | `depends: T-16.2.2`
- [x] **T-16.2.6** Create Zod validation schemas (`integrations.validation.ts`) — `ListProviderReposQuery` (search, page, per_page), `SyncReposBody` (repo_ids string[]), `UnsyncRepoParams` (id string) — `size: S`
- [x] **T-16.2.7** Add router endpoints — `GET /integrations/github/repos`, `POST /integrations/github/repos/sync`, `DELETE /integrations/github/repos/:id/sync`; same three for GitLab; all require auth + `manage_integrations` permission — `size: M` | `depends: T-16.2.3, T-16.2.5, T-16.2.6`
- [x] **T-16.2.8** Update Swagger spec — add all 6 new endpoints to `swagger.ts` with schemas and examples — `size: S` | `depends: T-16.2.7`

### Story 16.3: Repository Selection UI

Dashboard page for browsing and selecting repos to scan.

**Acceptance Criteria:**
- Searchable, paginated list of repos from connected provider
- Checkbox selection with "Select All" / "None" bulk actions
- Synced/unsynced status visible per repo
- "Sync Selected" button creates repos and starts first scan
- "Manage Repositories" button accessible from Integrations page

**Tasks:**

- [x] **T-16.3.1** Add React Query hooks — `useProviderRepos(provider, query)`, `useSyncRepos(provider)`, `useUnsyncRepo(provider)` in `dashboard/src/api/hooks.ts` — `size: S`
- [x] **T-16.3.2** Implement `RepoSelectionPage` component (`dashboard/src/pages/Integrations/RepoSelection.tsx`) — searchable list with checkboxes, per row: checkbox + owner/name + language badge + visibility icon + last updated + synced badge; top bar: search input + "Select All"/"None" + count; bottom: "Sync Selected" button — `size: L` | `depends: T-16.3.1`
- [x] **T-16.3.3** Add "Manage Repositories" button to IntegrationsPage — show when GitHub or GitLab is connected, navigates to `/integrations/:provider/repos` — `size: S` | `depends: T-16.3.2`
- [x] **T-16.3.4** Add route in `App.tsx` — `<Route path="/integrations/:provider/repos">` wrapped in `ProtectedLayout` — `size: S` | `depends: T-16.3.2`

### Story 16.4: Repository Selection Tests

**Acceptance Criteria:**
- All new endpoints tested with auth, permissions, search, pagination
- Sync creates repo records, unsync preserves data
- ≥80% coverage on new code

**Tasks:**

- [x] **T-16.4.1** Write integration tests for repo discovery endpoints — test `GET /integrations/github/repos` (auth, permissions, search filtering, pagination, synced annotation), `POST .../sync` (creates records, configures webhooks), `DELETE .../unsync` (preserves data); mock GitHub/GitLab API calls — `size: M` | `depends: T-16.2.7`
- [x] **T-16.4.2** Write integration tests for GitLab repo discovery — same coverage as GitHub tests — `size: M` | `depends: T-16.2.7`

---

## Epic 17: Onboarding — Cloud Infrastructure Discovery

### Story 17.1: Cloud Resource Schema

Database model for caching discovered cloud instances.

**Acceptance Criteria:**
- `cloud_resources` table created with provider, resource ID, hostname, IP, server link
- Unique constraint on `(org_id, provider, resource_id)`
- Relations to Organization, Integration, Server

**Tasks:**

- [ ] **T-17.1.1** Add `CloudResource` model to Prisma schema — id, orgId, integrationId (FK), provider (aws/azure/gcp/proxmox), resourceType (ec2/vm/container), resourceId, hostname, ipAddress, region, status (running/stopped/terminated), osInfo, serverId (nullable FK to Server), lastSyncedAt; unique `(orgId, provider, resourceId)`; indexes on `serverId` — `size: S`
- [ ] **T-17.1.2** Add `cloudResources` relation to Organization, Integration, and Server models — `size: S` | `depends: T-17.1.1`
- [ ] **T-17.1.3** Run Prisma migration — `npx prisma migrate dev --name add-cloud-resources` — `size: S` | `depends: T-17.1.2`

### Story 17.2: Cloud Provider Clients

API clients for discovering instances from AWS, Azure, and GCP.

**Acceptance Criteria:**
- Each client implements a shared `CloudDiscoveryClient` interface
- AWS discovers EC2 instances across the configured region
- Azure discovers VMs across all resource groups
- GCP discovers Compute Engine instances across all zones
- All return normalized `DiscoveredResource` objects

**Tasks:**

- [x] **T-17.2.1** Define shared `CloudDiscoveryClient` interface + `DiscoveredResource` type (`platform-api/src/lib/cloud/types.ts`) — interface: `discoverInstances(): Promise<DiscoveredResource[]>`; type: `{ resourceId, hostname, ipAddress, region, status, osInfo, resourceType }` — `size: S`
- [x] **T-17.2.2** Implement AWS discovery client (`src/lib/cloud/aws.ts`) — uses `@aws-sdk/client-ec2` `DescribeInstances`; supports access key or IAM role assumption via `@aws-sdk/client-sts`; returns normalized resources — `size: M`
- [x] **T-17.2.3** Implement Azure discovery client (`src/lib/cloud/azure.ts`) — uses `@azure/arm-compute` + `@azure/identity`; lists VMs across all resource groups; service principal auth — `size: M`
- [x] **T-17.2.4** Implement GCP discovery client (`src/lib/cloud/gcp.ts`) — uses `@google-cloud/compute`; lists instances across all zones; service account auth — `size: M`
- [x] **T-17.2.5** Implement factory function `createCloudClient(provider, config)` in `types.ts` — routes to correct client implementation — `size: S` | `depends: T-17.2.2, T-17.2.3, T-17.2.4`
- [x] **T-17.2.6** Install npm dependencies — `@aws-sdk/client-ec2`, `@aws-sdk/client-sts`, `@azure/arm-compute`, `@azure/identity`, `@google-cloud/compute` — `size: S`

### Story 17.3: Cloud Discovery API

Service and endpoints for connecting cloud accounts and discovering resources.

**Acceptance Criteria:**
- Cloud accounts connectable with credential validation
- Resources discoverable on demand and via periodic job
- Agent-to-instance matching works by instance ID → hostname → IP
- Unmonitored servers (instances without agents) queryable
- Coverage stats show percentage per provider/region

**Tasks:**

- [x] **T-17.3.1** Implement cloud discovery service (`platform-api/src/modules/integrations/cloud-discovery.service.ts`) — `connectCloudProvider(orgId, provider, config)`: validate credentials via test discovery, create integration; `discoverResources(orgId, provider)`: fetch instances, upsert `cloud_resources`, match agents (by cloudInstanceId → hostname → IP); `listDiscoveredResources(orgId, provider, query)`: paginated with joined server data; `getUnmonitoredServers(orgId)`: `WHERE serverId IS NULL`; `getCoverageStats(orgId)`: aggregate by provider+region — `size: L` | `depends: T-17.1.3, T-17.2.5`
- [x] **T-17.3.2** Add cloud discovery router endpoints — `POST /integrations/aws` (connect AWS), `POST /integrations/azure`, `POST /integrations/gcp`, `GET /integrations/:provider/resources` (paginated, filterable by region/status), `GET /servers/unmonitored`, `POST /integrations/:provider/discover` (trigger manual re-discovery); Zod validation for all — `size: M` | `depends: T-17.3.1`
- [x] **T-17.3.3** Add BullMQ `cloud-discovery` queue + processor — repeatable job every 6h; iterates all active cloud integrations, runs `discoverResources` for each; stagger per-integration to respect rate limits — `size: M` | `depends: T-17.3.1`
- [x] **T-17.3.4** Update Swagger spec — add all cloud discovery endpoints with schemas — `size: S` | `depends: T-17.3.2`

### Story 17.4: Infrastructure Coverage UI

Dashboard showing cloud instance coverage and agent gaps.

**Acceptance Criteria:**
- Overall coverage percentage bar displayed
- Per-provider/region breakdown with instance/agent counts
- Unmonitored servers listed with "Install Agent" button
- Cloud connection modals for AWS, Azure, GCP on Integrations page

**Tasks:**

- [x] **T-17.4.1** Add React Query hooks — `useCloudResources(provider, query)`, `useUnmonitoredServers()`, `useCoverageStats()`, `useConnectCloud(provider)`, `useTriggerDiscovery(provider)` — `size: S`
- [x] **T-17.4.2** Implement `InfrastructureCoveragePage` (`dashboard/src/pages/Infrastructure/CoverageDashboard.tsx`) — overall coverage bar, per-provider/region table (instances, agents, coverage %), unmonitored servers list with "Install Agent" button (copies install command), "Connect Cloud Account" link — `size: L` | `depends: T-17.4.1`
- [x] **T-17.4.3** Add route `/infrastructure/coverage` and sidebar nav item — `size: S` | `depends: T-17.4.2`
- [x] **T-17.4.4** Add cloud connection modals to IntegrationsPage — AWS (region, accessKeyId/roleArn), Azure (tenantId, clientId, clientSecret), GCP (projectId, service account key upload) — `size: M`

### Story 17.5: Cloud Discovery Tests

**Acceptance Criteria:**
- Cloud client normalization tested per provider
- Discovery endpoints tested with mocked cloud API responses
- Coverage stats aggregation verified

**Tasks:**

- [ ] **T-17.5.1** Write unit tests for AWS discovery client — mock `DescribeInstances`, test normalization, error handling — `size: S`
- [ ] **T-17.5.2** Write unit tests for Azure discovery client — mock Compute API, test multi-resource-group listing — `size: S`
- [ ] **T-17.5.3** Write unit tests for GCP discovery client — mock Compute Engine, test multi-zone listing — `size: S`
- [ ] **T-17.5.4** Write integration tests for cloud discovery endpoints — test connect (credential validation), discover (upserts resources), list resources, unmonitored servers, coverage stats; mock cloud clients — `size: M` | `depends: T-17.3.2`

---

## Epic 18: Onboarding — Domain Monitoring

### Story 18.1: Monitored Endpoint Schema

Database model for tracking domains/endpoints to monitor.

**Acceptance Criteria:**
- `monitored_endpoints` table created with host, port, status, check history
- Unique constraint on `(org_id, host, port)`

**Tasks:**

- [x] **T-18.1.1** Add `MonitoredEndpoint` model to Prisma schema — id, orgId (FK), host, port (default 443), label, checkInterval (default '1h'), status (active/paused), lastCheckedAt, lastStatus (healthy/unhealthy/unreachable), lastResponseMs, createdAt; unique `(orgId, host, port)`; index `(orgId, status)` — `size: S`
- [x] **T-18.1.2** Run Prisma migration — `npx prisma migrate dev --name add-monitored-endpoints` — `size: S` | `depends: T-18.1.1`

### Story 18.2: Domain Monitoring Service

Service, router, and BullMQ job for TLS probe monitoring.

**Acceptance Criteria:**
- Users can add, list, and remove monitored endpoints
- Immediate TLS probe triggerable per endpoint
- Periodic checks run per endpoint's configured interval
- TLS probe extracts certificate details, measures response time
- Unhealthy/expired certs generate findings with correct severity
- Unreachable endpoints generate findings

**Tasks:**

- [x] **T-18.2.1** Create domain monitoring service (`platform-api/src/modules/monitoring/monitoring.service.ts`) — `addEndpoints(orgId, endpoints[], checkInterval)`: validate hosts, create records, enqueue initial checks; `listEndpoints(orgId, query)`: paginated with latest status; `removeEndpoint(orgId, endpointId)`: delete record; `triggerCheck(orgId, endpointId)`: enqueue immediate TLS probe — `size: M` | `depends: T-18.1.2`
- [x] **T-18.2.2** Create Zod validation schemas (`monitoring.validation.ts`) — `AddEndpointsBody` (array of `{ host, port }`, checkInterval), `ListEndpointsQuery` (page, per_page, status), `EndpointIdParams` (uuid) — `size: S`
- [x] **T-18.2.3** Create monitoring router (`monitoring.router.ts`) — `POST /monitoring/domains`, `GET /monitoring/domains`, `DELETE /monitoring/domains/:id`, `POST /monitoring/domains/:id/check`; auth + RBAC — `size: M` | `depends: T-18.2.1, T-18.2.2`
- [x] **T-18.2.4** Register monitoring router in `app.ts` at `/api/v1/monitoring` — `size: S` | `depends: T-18.2.3`
- [x] **T-18.2.5** Create domain monitoring BullMQ job (`jobs/domain-monitoring.processor.ts`) — add `domain-monitoring` queue to `queues.ts`; processor: TLS connect (Node.js `tls.connect`, 10s timeout), extract cert details, measure response time, determine health, update `monitored_endpoints` record, upsert `Certificate` + create `Finding` records per severity table (expired=critical, ≤7d=critical, ≤30d=high, ≤60d=medium, ≤90d=low, weak key=high, SHA-1=high, self-signed=medium, incomplete chain=medium, unreachable=high) — `size: L` | `depends: T-18.2.1`
- [x] **T-18.2.6** Implement repeatable job scheduler — reads active endpoints from DB, schedules per-endpoint jobs based on `checkInterval` (1h/6h/24h) — `size: M` | `depends: T-18.2.5`
- [ ] **T-18.2.7** Update Swagger spec — add all monitoring endpoints — `size: S` | `depends: T-18.2.3`

### Story 18.3: Domain Monitoring UI

Dashboard page for managing monitored domains.

**Acceptance Criteria:**
- Users can add domains (single or bulk via textarea)
- Endpoint list shows status indicators (green/yellow/red)
- Last checked time, response time, cert expiry visible
- "Check Now" button per endpoint
- Remove button with confirmation

**Tasks:**

- [x] **T-18.3.1** Add React Query hooks — `useMonitoredEndpoints(query)`, `useAddEndpoints()`, `useRemoveEndpoint()`, `useTriggerCheck()` — `size: S`
- [x] **T-18.3.2** Implement `DomainMonitoringPage` (`dashboard/src/pages/Monitoring/DomainMonitoring.tsx`) — "Add Domain" form (host + port, bulk add textarea), endpoint list with status indicators (green=healthy, yellow=expiring, red=unhealthy/unreachable), last checked, response time, cert expiry, "Check Now" and "Remove" buttons — `size: M` | `depends: T-18.3.1`
- [x] **T-18.3.3** Add route `/monitoring/domains` and sidebar nav item "Monitoring" — `size: S` | `depends: T-18.3.2`

### Story 18.4: Domain Monitoring Tests

**Acceptance Criteria:**
- TLS probe logic tested (connection, cert parsing, severity, timeout)
- CRUD endpoints tested
- Finding creation verified for unhealthy endpoints

**Tasks:**

- [x] **T-18.4.1** Write unit tests for TLS probe processor — test TLS connection, cert extraction, severity classification (per all levels), timeout handling, unreachable endpoints, finding creation — `size: M` | `depends: T-18.2.5`
- [x] **T-18.4.2** Write integration tests for monitoring endpoints — test add, list, remove, trigger check; verify finding creation for expired cert; mock TLS connection — `size: M` | `depends: T-18.2.3`

---

## Epic 19: Onboarding — Proxmox, Bitbucket & Wizard

### Story 19.1: Proxmox Discovery

Connect Proxmox clusters to discover VMs and containers.

**Acceptance Criteria:**
- Proxmox connectable via API token (token ID + secret)
- VMs and LXC containers discovered across all nodes
- Self-signed cert support via `verifySsl: false`
- Discovered VMs appear in cloud resource list and coverage dashboard

**Tasks:**

- [x] **T-19.1.1** Implement Proxmox API client (`platform-api/src/lib/cloud/proxmox.ts`) — implements `CloudDiscoveryClient` interface; Proxmox REST API: `GET /api2/json/nodes` → per-node `GET /qemu` + `/lxc`; `PVEAPIToken` header auth; supports `verifySsl: false` — `size: M` | `depends: T-17.2.1`
- [x] **T-19.1.2** Add Proxmox integration endpoint — `POST /integrations/proxmox` with body `{ baseUrl, tokenId, tokenSecret, verifySsl }`; register in cloud discovery factory — `size: S` | `depends: T-19.1.1, T-17.3.2`
- [x] **T-19.1.3** Add Proxmox modal to IntegrationsPage — base URL, token ID, token secret inputs, verify SSL toggle with warning — `size: S`
- [x] **T-19.1.4** Write unit tests for Proxmox client — mock REST API, test node enumeration, VM/container parsing, self-signed cert handling — `size: S` | `depends: T-19.1.1`

### Story 19.2: Bitbucket Integration

Connect Bitbucket for repo discovery and push webhooks.

**Acceptance Criteria:**
- Bitbucket connectable via App Password or OAuth2
- Repos discoverable and syncable (same UX as GitHub/GitLab)
- Push webhooks trigger code scans
- Both Bitbucket Cloud and Bitbucket Server (self-hosted) supported

**Tasks:**

- [x] **T-19.2.1** Implement Bitbucket API client (`platform-api/src/lib/bitbucket.ts`) — constructor takes auth credentials + optional `baseUrl` (for Bitbucket Server); methods: `listRepositories(workspace)`, `getRepository(workspace, slug)`, `createWebhook(workspace, slug, url)`, `deleteWebhook(workspace, slug, hookId)` — `size: M`
- [x] **T-19.2.2** Add Bitbucket integration service methods — `createBitbucketIntegration`, `listBitbucketRepos`, `syncBitbucketRepos`, `unsyncBitbucketRepo`, `handleBitbucketPushEvent`; follow same patterns as GitHub/GitLab — `size: M` | `depends: T-19.2.1`
- [x] **T-19.2.3** Add Bitbucket router endpoints — `POST /integrations/bitbucket`, `GET /integrations/bitbucket/repos`, `POST /integrations/bitbucket/repos/sync`, `DELETE /integrations/bitbucket/repos/:id/sync`, `POST /integrations/bitbucket/webhook` — `size: S` | `depends: T-19.2.2`
- [x] **T-19.2.4** Add Bitbucket card + modal to IntegrationsPage — workspace, app password inputs; "Manage Repos" button when connected — `size: S`
- [x] **T-19.2.5** Write unit tests for Bitbucket client — test `listRepositories`, Cloud vs Server API differences, webhook management — `size: S` | `depends: T-19.2.1`
- [x] **T-19.2.6** Write integration tests for Bitbucket endpoints — test connect, repo discovery, sync, webhook handling; mock Bitbucket API — `size: M` | `depends: T-19.2.3`

### Story 19.3: Onboarding Wizard

Guided first-time setup experience for new organizations.

**Acceptance Criteria:**
- New orgs see wizard instead of empty dashboard
- Three setup cards: Code, Servers, SSL
- Each card links to respective setup flow
- Wizard skippable ("Skip for now")
- Wizard not shown again after completion or skip
- Onboarding status queryable via API

**Tasks:**

- [x] **T-19.3.1** Add `onboardingCompleted` field to Organization model — `Boolean @default(false)`; run migration — `size: S`
- [x] **T-19.3.2** Add onboarding status endpoint — `GET /organizations/me/onboarding-status` returns `{ completed, steps: { code: bool, infrastructure: bool, ssl: bool } }` based on whether integrations/repos/agents/endpoints exist — `size: S` | `depends: T-19.3.1`
- [x] **T-19.3.3** Implement `OnboardingWizard` component (`dashboard/src/pages/Onboarding/OnboardingWizard.tsx`) — three cards: Code (connect GitHub/GitLab/Bitbucket → link to integrations), Servers (install agent → copy command, or connect cloud → link to integrations), SSL (add domains → link to monitoring); "Skip for now" at bottom; on completion/skip, marks onboarding complete via API — `size: L` | `depends: T-19.3.2`
- [x] **T-19.3.4** Add conditional redirect to wizard — on dashboard load, check onboarding status; if not completed, redirect to `/onboarding`; add route for wizard page — `size: S` | `depends: T-19.3.3`
- [x] **T-19.3.5** Add all provider cards to IntegrationsPage — Bitbucket, AWS, Azure, GCP, Proxmox with respective connection modals — `size: M` | `depends: T-19.1.3, T-19.2.4, T-17.4.4`

### Story 19.4: Onboarding Tests

**Acceptance Criteria:**
- Onboarding status endpoint tested
- Wizard redirect logic tested
- ≥80% coverage on new code

**Tasks:**

- [x] **T-19.4.1** Write integration tests for onboarding status endpoint — test returns correct step completion based on existing data — `size: S` | `depends: T-19.3.2`
- [x] **T-19.4.2** Write E2E test for onboarding flow — wizard displays for new org, skip works, connect provider flow works, redirect to dashboard on completion — `size: M` | `depends: T-19.3.4`

---

## Dependency Graph

```
Epic 16 (Repos) ──────────────────────────────────────────────►
  T-16.1.1 (GitLab client) ──► T-16.2.2 (GitLab repos) ──► T-16.2.5 (sync) ──► T-16.2.7 (router)
  T-16.1.3 (GH pagination)──► T-16.2.1 (GH repos) ──► T-16.2.3 (sync) ──► T-16.2.7 (router) ──► T-16.3.2 (UI)

Epic 17 (Cloud) ──────────────────────────────────────────────►
  T-17.1.1 (schema) ──► T-17.1.3 (migrate) ──► T-17.3.1 (service)
  T-17.2.1 (interface) ──► T-17.2.2/3/4 (clients) ──► T-17.2.5 (factory) ──► T-17.3.1 (service) ──► T-17.3.2 (router) ──► T-17.4.2 (UI)

Epic 18 (Domains) ────────────────────────────────────────────►
  T-18.1.1 (schema) ──► T-18.1.2 (migrate) ──► T-18.2.1 (service) ──► T-18.2.3 (router) ──► T-18.3.2 (UI)
                                                T-18.2.1 ──► T-18.2.5 (TLS probe job) ──► T-18.2.6 (scheduler)

Epic 19 (Wizard) ─────────────────────────────────────────────►
  T-19.1.1 (Proxmox) ──► T-19.1.2 (endpoint)
  T-19.2.1 (Bitbucket) ──► T-19.2.2 (service) ──► T-19.2.3 (router)
  T-19.3.1 (schema) ──► T-19.3.2 (status API) ──► T-19.3.3 (wizard UI) ──► T-19.3.4 (redirect)
```

---

## Progress Tracker

| Epic | Story | Tasks | Done | Progress |
|------|-------|-------|------|----------|
| 16 | 16.1 GitLab Client | 5 | 0 | ░░░░░░░░░░ 0% |
| 16 | 16.2 Discovery API | 8 | 0 | ░░░░░░░░░░ 0% |
| 16 | 16.3 Selection UI | 4 | 0 | ░░░░░░░░░░ 0% |
| 16 | 16.4 Tests | 2 | 0 | ░░░░░░░░░░ 0% |
| 17 | 17.1 Schema | 3 | 0 | ░░░░░░░░░░ 0% |
| 17 | 17.2 Cloud Clients | 6 | 0 | ░░░░░░░░░░ 0% |
| 17 | 17.3 Discovery API | 4 | 0 | ░░░░░░░░░░ 0% |
| 17 | 17.4 Coverage UI | 4 | 0 | ░░░░░░░░░░ 0% |
| 17 | 17.5 Tests | 4 | 0 | ░░░░░░░░░░ 0% |
| 18 | 18.1 Schema | 2 | 0 | ░░░░░░░░░░ 0% |
| 18 | 18.2 Monitoring Service | 7 | 0 | ░░░░░░░░░░ 0% |
| 18 | 18.3 Monitoring UI | 3 | 0 | ░░░░░░░░░░ 0% |
| 18 | 18.4 Tests | 2 | 0 | ░░░░░░░░░░ 0% |
| 19 | 19.1 Proxmox | 4 | 0 | ░░░░░░░░░░ 0% |
| 19 | 19.2 Bitbucket | 6 | 0 | ░░░░░░░░░░ 0% |
| 19 | 19.3 Wizard | 5 | 0 | ░░░░░░░░░░ 0% |
| 19 | 19.4 Tests | 2 | 0 | ░░░░░░░░░░ 0% |
| **Total** | **17 stories** | **71 tasks** | **0** | **0%** |
