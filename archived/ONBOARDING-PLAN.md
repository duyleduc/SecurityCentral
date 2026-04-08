# SecurityCentral — Onboarding Implementation Plan

**Version:** 1.0.0
**Status:** Approved
**Spec:** `ONBOARDING-SPEC.md`
**Scope:** 53 steps across 4 phases (~7 weeks total)

---

## Table of Contents

1. [Overview](#overview)
2. [What Exists vs What's New](#what-exists-vs-whats-new)
3. [Phase 1: Repository Selection](#phase-1-repository-selection-api--ui-github--gitlab)
4. [Phase 2: Cloud Infrastructure Discovery](#phase-2-cloud-infrastructure-discovery-aws--azure--gcp)
5. [Phase 3: Domain Monitoring](#phase-3-manual-domain-monitoring-ssl--uptime)
6. [Phase 4: Proxmox + Bitbucket + Wizard](#phase-4-proxmox--bitbucket--onboarding-wizard)
7. [Database Schema Changes](#database-schema-changes-summary)
8. [New API Endpoints](#new-api-endpoints-summary)
9. [New Dashboard Components](#new-dashboard-components-summary)
10. [New BullMQ Queues](#new-bullmq-queues)
11. [New npm Dependencies](#new-npm-dependencies)
12. [Risks & Mitigations](#risks--mitigations)
13. [Success Criteria](#success-criteria)
14. [Estimated Timeline](#estimated-timeline)
15. [STORIES.md Task Numbering](#storiesmd-task-numbering)

---

## Overview

Users need to import their projects, servers, and domains into SecurityCentral before scanning begins. This plan implements an **integration-first with selective sync** model: users connect their source code provider or cloud account once, SecurityCentral discovers all available resources, and users choose which ones to monitor.

---

## What Exists vs What's New

### Already Exists

| Component | Location |
|-----------|----------|
| Integration model (`integrations` table) with `provider`, `status`, `config` JSONB | `prisma/schema.prisma:261` |
| GitHub App integration: `createGitHubIntegration`, push/installation webhook handlers | `integrations.service.ts` |
| GitHubClient with `listRepositories()`, `forInstallation()` | `src/lib/github.ts` |
| GitLab integration: `createGitLabIntegration`, push webhook handler | `integrations.service.ts` |
| Repository CRUD: `listRepositories`, `createRepository`, `getRepositoryById`, `triggerScan` | `repositories.service.ts` |
| Server model with `cloudProvider`, `cloudRegion`, `cloudInstanceId`, `agentId` | `prisma/schema.prisma:134` |
| Certificate model with full cert metadata | `prisma/schema.prisma:162` |
| Dashboard IntegrationsPage with connect/disconnect modals | `dashboard/src/pages/Integrations/` |
| Middleware: auth, RBAC, Zod validation, rate limiting, error handling | `src/middleware/` |
| BullMQ queues: scan-orchestration, finding-ingestion, notifications, es-sync | `src/jobs/queues.ts` |

### Must Build (New)

| Component | Phase |
|-----------|-------|
| Provider repo discovery endpoints (`GET /integrations/:provider/repos`, sync/unsync) | 1 |
| GitLab API client (`src/lib/gitlab.ts`) | 1 |
| Pagination support for `GitHubClient.listRepositories` | 1 |
| RepoSelectionPage (dashboard) | 1 |
| Cloud provider clients: AWS EC2, Azure VM, GCP Compute | 2 |
| `CloudResource` Prisma model | 2 |
| Cloud discovery service + coverage stats | 2 |
| InfrastructureCoveragePage (dashboard) | 2 |
| `MonitoredEndpoint` Prisma model | 3 |
| Domain monitoring service + TLS probe BullMQ job | 3 |
| DomainMonitoringPage (dashboard) | 3 |
| Proxmox API client | 4 |
| Bitbucket API client + integration endpoints | 4 |
| OnboardingWizard (dashboard) | 4 |

---

## Phase 1: Repository Selection API + UI (GitHub / GitLab)

**Goal:** After connecting GitHub or GitLab, users can see all accessible repos, select which ones to scan, and sync them with one click.

**Estimated effort:** ~2 weeks (16 steps)

### Phase 1.1: GitLab API Client

#### Step 1: Create GitLab API client

- **File:** `platform-api/src/lib/gitlab.ts` (new)
- **Action:** Implement `GitLabClient` class mirroring the `GitHubClient` pattern. Constructor takes `accessToken` and optional `baseUrl` (defaults to `https://gitlab.com`).
- **Methods:** `listProjects()` (paginated via `X-Next-Page` headers), `getProject(id)`, `createWebhook(projectId, url, token)`, `deleteWebhook(projectId, hookId)`
- **Risk:** Medium — GitLab pagination uses header-based navigation
- **Complexity:** M

#### Step 2: Add self-hosted base URL support to GitLab integration

- **File:** `platform-api/src/modules/integrations/integrations.service.ts`
- **Action:** Extend `createGitLabIntegration` to accept optional `baseUrl` and `verifySsl` parameters. Store in `config` JSONB as `{ access_token, base_url, verify_ssl }`.
- **Complexity:** S

#### Step 3: Add pagination support to GitHubClient.listRepositories

- **File:** `platform-api/src/lib/github.ts`
- **Action:** Currently fetches one page. Extend to follow GitHub's `Link` header pagination to fetch all repos (orgs can have hundreds).
- **Complexity:** S

### Phase 1.2: Repo Discovery API Endpoints

#### Step 4: Implement GitHub repo discovery endpoint

- **File:** `platform-api/src/modules/integrations/integrations.service.ts`
- **Action:** Add `listGitHubRepos(orgId, query: { search?, page, per_page })`. Fetches repos from GitHub API via `GitHubClient.forInstallation()`, cross-references with `repositories` table to annotate each repo with `synced: boolean`.
- **Returns:** `[{ id, full_name, language, visibility, default_branch, updated_at, synced }]`
- **Risk:** Medium — must handle rate limits; consider 5-min Redis cache
- **Complexity:** M

#### Step 5: Implement GitLab repo discovery endpoint

- **File:** Same service file
- **Action:** Add `listGitLabRepos(orgId, query)`. Uses `GitLabClient` with stored access token and base URL from integration config. Same cross-reference logic as GitHub.
- **Complexity:** M

#### Step 6: Implement repo sync endpoint (GitHub)

- **File:** Same service file
- **Action:** Add `syncGitHubRepos(orgId, repoIds: string[])`. For each repo ID: fetch details from GitHub API, upsert into `repositories` table, configure webhook. Add `unsyncGitHubRepo(orgId, repoProviderId)` to remove webhook and mark repo as archived (preserve historical data).
- **Risk:** Medium — webhook creation can fail; need per-repo error handling with partial success
- **Complexity:** M

#### Step 7: Implement repo sync endpoint (GitLab)

- **File:** Same service file
- **Action:** Mirror of step 6 for GitLab. Uses `GitLabClient.createWebhook()`.
- **Complexity:** M

#### Step 8: Add router endpoints for repo discovery and sync

- **File:** `platform-api/src/modules/integrations/integrations.router.ts`
- **Action:** Add routes:
  - `GET /integrations/github/repos` — requires auth + `manage_integrations`
  - `POST /integrations/github/repos/sync` — body `{ repo_ids: string[] }`
  - `DELETE /integrations/github/repos/:id/sync`
  - Same three for `/integrations/gitlab/repos`
- **Complexity:** M

#### Step 9: Add validation schemas

- **File:** `platform-api/src/modules/integrations/integrations.validation.ts` (new)
- **Action:** Zod schemas: `ListProviderReposQuery` (search, page, per_page), `SyncReposBody` (repo_ids string[]), `UnsyncRepoParams` (id string)
- **Complexity:** S

### Phase 1.3: Dashboard — Repo Selection UI

#### Step 10: Create RepoSelectionPage component

- **File:** `dashboard/src/pages/Integrations/RepoSelection.tsx` (new)
- **Action:** Searchable, paginated repo list with checkboxes. Per row: checkbox, owner/name, language badge, visibility icon, last updated, synced/unsynced badge. Top bar: search, "Select All" / "None", count. Bottom: "Sync Selected Repositories" button.
- **Risk:** Medium — pagination + search + checkbox state management
- **Complexity:** L

#### Step 11: Add "Manage Repos" button to IntegrationsPage

- **File:** `dashboard/src/pages/Integrations/index.tsx`
- **Action:** When GitHub/GitLab connected, show "Manage Repositories" button navigating to `/integrations/:provider/repos`.
- **Complexity:** S

#### Step 12: Add route for repo selection

- **File:** `dashboard/src/App.tsx`
- **Action:** `<Route path="/integrations/:provider/repos" element={<ProtectedLayout><RepoSelectionPage /></ProtectedLayout>} />`
- **Complexity:** S

#### Step 13: Add API hooks for repo discovery

- **File:** `dashboard/src/api/hooks.ts`
- **Action:** Add `useProviderRepos(provider, query)`, `useSyncRepos(provider)`, `useUnsyncRepo(provider)` React Query hooks.
- **Complexity:** S

### Phase 1.4: Tests

#### Step 14: Unit tests for GitLab client

- **File:** `platform-api/tests/lib/gitlab.test.ts`
- **Action:** Test `listProjects`, pagination, self-hosted base URL, error cases. Mock `fetch`.
- **Complexity:** S

#### Step 15: Integration tests for repo discovery endpoints

- **File:** `platform-api/tests/modules/integrations/repo-discovery.test.ts`
- **Action:** Test all 6 endpoints. Mock GitHub/GitLab API calls. Test auth, permissions, search filtering, pagination, sync creates records, unsync preserves data.
- **Complexity:** M

#### Step 16: Unit tests for GitHub pagination

- **File:** `platform-api/tests/lib/github-pagination.test.ts`
- **Action:** Test multi-page pagination logic.
- **Complexity:** S

---

## Phase 2: Cloud Infrastructure Discovery (AWS / Azure / GCP)

**Goal:** Connect cloud accounts, discover all compute instances, show coverage gaps (instances without agents), enable one-click agent install.

**Estimated effort:** ~2 weeks (14 steps)

### Phase 2.1: Database Schema

#### Step 17: Add CloudResource model to Prisma schema

- **File:** `platform-api/prisma/schema.prisma`
- **Action:** Add `CloudResource` model:

```prisma
model CloudResource {
  id             String       @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  orgId          String       @map("org_id") @db.Uuid
  integrationId  String       @map("integration_id") @db.Uuid
  provider       String       // aws | azure | gcp | proxmox
  resourceType   String       @map("resource_type") // ec2 | vm | container
  resourceId     String       @map("resource_id") // provider instance ID
  hostname       String?
  ipAddress      String?      @map("ip_address")
  region         String?
  status         String?      // running | stopped | terminated
  osInfo         String?      @map("os_info")
  serverId       String?      @map("server_id") @db.Uuid
  lastSyncedAt   DateTime     @default(now()) @map("last_synced_at") @db.Timestamptz()

  organization   Organization @relation(fields: [orgId], references: [id])
  integration    Integration  @relation(fields: [integrationId], references: [id])
  server         Server?      @relation(fields: [serverId], references: [id])

  @@unique([orgId, provider, resourceId])
  @@index([serverId], map: "idx_cloud_resources_server")
  @@map("cloud_resources")
}
```

- **Complexity:** S

#### Step 18: Add CloudResource relations to existing models

- **File:** Same schema file
- **Action:** Add `cloudResources CloudResource[]` to `Organization`, `Integration`, and `Server` models.
- **Complexity:** S

### Phase 2.2: Cloud Provider Clients

#### Step 19: Create AWS discovery client

- **File:** `platform-api/src/lib/cloud/aws.ts` (new)
- **Action:** `AwsDiscoveryClient` using `@aws-sdk/client-ec2`. Takes `region`, optional `accessKeyId`/`secretAccessKey` or `roleArn`. Method `discoverInstances()` calls `DescribeInstances`, returns normalized `{ resourceId, hostname, ipAddress, region, status, osInfo, resourceType }`.
- **Dependencies:** npm: `@aws-sdk/client-ec2`, `@aws-sdk/client-sts`
- **Complexity:** M

#### Step 20: Create Azure discovery client

- **File:** `platform-api/src/lib/cloud/azure.ts` (new)
- **Action:** `AzureDiscoveryClient` using `@azure/arm-compute` + `@azure/identity`. Takes `tenantId`, `clientId`, `clientSecret`. Lists VMs across all resource groups.
- **Dependencies:** npm: `@azure/arm-compute`, `@azure/identity`
- **Complexity:** M

#### Step 21: Create GCP discovery client

- **File:** `platform-api/src/lib/cloud/gcp.ts` (new)
- **Action:** `GcpDiscoveryClient` using `@google-cloud/compute`. Takes `projectId` + service account key. Lists instances across all zones.
- **Dependencies:** npm: `@google-cloud/compute`
- **Complexity:** M

#### Step 22: Create shared cloud discovery interface

- **File:** `platform-api/src/lib/cloud/types.ts` (new)
- **Action:** Define `CloudDiscoveryClient` interface + `DiscoveredResource` type. Factory function `createCloudClient(provider, config)`.
- **Complexity:** S

### Phase 2.3: Cloud Discovery API

#### Step 23: Implement cloud integration service

- **File:** `platform-api/src/modules/integrations/cloud-discovery.service.ts` (new)
- **Action:**
  - `connectCloudProvider(orgId, provider, config)` — validate credentials via test discovery, create integration record
  - `discoverResources(orgId, provider)` — fetch instances, upsert `cloud_resources`, match agents (by `cloudInstanceId` → hostname → IP)
  - `listDiscoveredResources(orgId, provider, query)` — paginated with joined server data
  - `getUnmonitoredServers(orgId)` — `cloud_resources WHERE serverId IS NULL`
  - `getCoverageStats(orgId)` — aggregate by provider+region: total, agents, percentage
- **Risk:** High — credential validation and agent matching are complex
- **Complexity:** L

#### Step 24: Add cloud discovery router endpoints

- **File:** `platform-api/src/modules/integrations/integrations.router.ts`
- **Action:** Routes:
  - `POST /integrations/aws` — connect AWS
  - `POST /integrations/azure` — connect Azure
  - `POST /integrations/gcp` — connect GCP
  - `GET /integrations/:provider/resources` — list resources (paginated, filterable by region/status)
  - `GET /servers/unmonitored` — instances without agents
  - `POST /integrations/:provider/discover` — trigger manual re-discovery
- **Complexity:** M

#### Step 25: Add BullMQ job for periodic cloud discovery

- **File:** `platform-api/src/jobs/cloud-discovery.processor.ts` (new)
- **Action:** Add `cloud-discovery` queue to `queues.ts`. Repeatable job every 6h. Iterates all active cloud integrations, runs `discoverResources` for each.
- **Risk:** Medium — must handle rate limits; stagger per-integration
- **Complexity:** M

### Phase 2.4: Dashboard — Infrastructure Coverage

#### Step 26: Create InfrastructureCoveragePage

- **File:** `dashboard/src/pages/Infrastructure/CoverageDashboard.tsx` (new)
- **Action:** Overall coverage bar, per-provider/region table (instances, agents, coverage %), unmonitored servers list with "Install Agent" button (copies install command), "Connect Cloud Account" button.
- **Complexity:** L

#### Step 27: Add route and navigation

- **File:** `dashboard/src/App.tsx` + `components/AppShell.tsx`
- **Action:** Route `/infrastructure/coverage`, sidebar nav item.
- **Complexity:** S

#### Step 28: Add cloud connection modals to IntegrationsPage

- **File:** `dashboard/src/pages/Integrations/index.tsx`
- **Action:** Add AWS, Azure, GCP to PROVIDERS array. Create `AwsModal` (region, accessKeyId/roleArn), `AzureModal` (tenantId, clientId, clientSecret), `GcpModal` (projectId, service account key upload).
- **Risk:** Medium — file upload for GCP service account key
- **Complexity:** M

### Phase 2.5: Tests

#### Step 29: Unit tests for cloud discovery clients

- **Files:** `tests/lib/cloud/aws.test.ts`, `azure.test.ts`, `gcp.test.ts`
- **Action:** Mock SDK calls, test normalization, error handling, pagination.
- **Complexity:** M

#### Step 30: Integration tests for cloud discovery endpoints

- **File:** `tests/modules/integrations/cloud-discovery.test.ts`
- **Action:** Test connect, discover, list resources, unmonitored, coverage stats. Mock cloud clients.
- **Complexity:** M

---

## Phase 3: Manual Domain Monitoring (SSL + Uptime)

**Goal:** Users add domains/endpoints to monitor for TLS certificate health and endpoint reachability.

**Estimated effort:** ~1.5 weeks (10 steps)

### Phase 3.1: Database Schema

#### Step 31: Add MonitoredEndpoint model to Prisma schema

- **File:** `platform-api/prisma/schema.prisma`
- **Action:** Add model:

```prisma
model MonitoredEndpoint {
  id             String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  orgId          String    @map("org_id") @db.Uuid
  host           String
  port           Int       @default(443)
  label          String?
  checkInterval  String    @default("1h") @map("check_interval")
  status         String    @default("active") // active | paused
  lastCheckedAt  DateTime? @map("last_checked_at") @db.Timestamptz()
  lastStatus     String?   @map("last_status") // healthy | unhealthy | unreachable
  lastResponseMs Int?      @map("last_response_ms")
  createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamptz()

  organization   Organization @relation(fields: [orgId], references: [id])

  @@unique([orgId, host, port])
  @@index([orgId, status], map: "idx_monitored_endpoints_org_status")
  @@map("monitored_endpoints")
}
```

- **Complexity:** S

### Phase 3.2: Domain Monitoring Service

#### Step 32: Create domain monitoring service

- **File:** `platform-api/src/modules/monitoring/monitoring.service.ts` (new)
- **Action:**
  - `addEndpoints(orgId, endpoints[], checkInterval)` — validate hosts, create records, enqueue initial check
  - `listEndpoints(orgId, query)` — paginated with latest status
  - `removeEndpoint(orgId, endpointId)` — delete record
  - `triggerCheck(orgId, endpointId)` — enqueue immediate TLS probe
- **Complexity:** M

#### Step 33: Create domain monitoring router

- **File:** `platform-api/src/modules/monitoring/monitoring.router.ts` (new)
- **Action:** Routes:
  - `POST /monitoring/domains` — add endpoints
  - `GET /monitoring/domains` — list with status
  - `DELETE /monitoring/domains/:id` — remove
  - `POST /monitoring/domains/:id/check` — immediate probe
- **Complexity:** M

#### Step 34: Create monitoring validation schemas

- **File:** `platform-api/src/modules/monitoring/monitoring.validation.ts` (new)
- **Action:** Zod schemas for `AddEndpointsBody`, `ListEndpointsQuery`, `EndpointIdParams`.
- **Complexity:** S

#### Step 35: Register monitoring router in app

- **File:** `platform-api/src/app.ts`
- **Action:** Mount at `/api/v1/monitoring`.
- **Complexity:** S

#### Step 36: Create domain monitoring BullMQ job

- **File:** `platform-api/src/jobs/domain-monitoring.processor.ts` (new)
- **Action:** Add `domain-monitoring` queue. Processor: TLS connect → extract cert → measure response time → determine health → update `monitored_endpoints` → create/update `Certificate` + `Finding` records for issues. Severity per ONBOARDING-SPEC §5.3 table.
- **Risk:** High — TLS probing, cert parsing, timeout handling, finding generation
- **Complexity:** L

### Phase 3.3: Dashboard — Domain Monitoring

#### Step 37: Create DomainMonitoringPage

- **File:** `dashboard/src/pages/Monitoring/DomainMonitoring.tsx` (new)
- **Action:** "Add Domain" form (host + port), list of endpoints with status indicators (green/yellow/red), last checked time, response time, cert expiry. "Check Now" and "Remove" buttons.
- **Complexity:** M

#### Step 38: Add route and navigation

- **File:** `dashboard/src/App.tsx` + `components/AppShell.tsx`
- **Action:** Route `/monitoring/domains`, sidebar nav item.
- **Complexity:** S

### Phase 3.4: Tests

#### Step 39: Unit tests for TLS probe logic

- **File:** `tests/jobs/domain-monitoring.test.ts`
- **Action:** TLS connection, cert parsing, severity classification, timeout, unreachable endpoints.
- **Complexity:** M

#### Step 40: Integration tests for monitoring endpoints

- **File:** `tests/modules/monitoring/monitoring.test.ts`
- **Action:** Add, list, remove, trigger check. Verify finding creation.
- **Complexity:** M

---

## Phase 4: Proxmox + Bitbucket + Onboarding Wizard

**Goal:** Complete provider coverage and guided first-time setup.

**Estimated effort:** ~1.5 weeks (13 steps)

### Phase 4.1: Proxmox Discovery

#### Step 41: Create Proxmox API client

- **File:** `platform-api/src/lib/cloud/proxmox.ts` (new)
- **Action:** Implements `CloudDiscoveryClient` interface. Proxmox REST API: `GET /api2/json/nodes` → per-node `GET /qemu` + `/lxc`. Token auth via `PVEAPIToken` header. Supports `verifySsl: false`.
- **Complexity:** M

#### Step 42: Add Proxmox integration endpoint

- **File:** Integrations router
- **Action:** `POST /integrations/proxmox` — body `{ baseUrl, tokenId, tokenSecret, verifySsl }`.
- **Complexity:** S

### Phase 4.2: Bitbucket Integration

#### Step 43: Create Bitbucket API client

- **File:** `platform-api/src/lib/bitbucket.ts` (new)
- **Action:** `BitbucketClient` with App Password or OAuth2. Methods: `listRepositories(workspace)`, `getRepository(workspace, slug)`, `createWebhook(workspace, slug, url)`. Support Cloud + Server.
- **Risk:** Medium — Cloud vs Server API differences
- **Complexity:** M

#### Step 44: Add Bitbucket integration service methods

- **File:** `integrations.service.ts`
- **Action:** `createBitbucketIntegration`, `listBitbucketRepos`, `syncBitbucketRepos`, `handleBitbucketPushEvent`. Same patterns as GitHub/GitLab.
- **Complexity:** M

#### Step 45: Add Bitbucket router endpoints

- **File:** Integrations router
- **Action:** `POST /integrations/bitbucket`, `GET /integrations/bitbucket/repos`, `POST /integrations/bitbucket/repos/sync`, `POST /integrations/bitbucket/webhook`.
- **Complexity:** S

### Phase 4.3: Onboarding Wizard

#### Step 46: Add onboarding state tracking

- **File:** `prisma/schema.prisma` + new endpoint
- **Action:** Add `onboardingCompleted Boolean @default(false)` to Organization. Endpoint `GET /organizations/me/onboarding-status` returns `{ completed, steps: { code, infrastructure, ssl } }`.
- **Complexity:** S

#### Step 47: Create OnboardingWizard component

- **File:** `dashboard/src/pages/Onboarding/OnboardingWizard.tsx` (new)
- **Action:** Three cards: Code (connect GitHub/GitLab/Bitbucket), Servers (install agent or connect cloud), SSL (add domains). Each leads to respective setup flow. "Skip for now" link. On completion, marks org onboarding complete.
- **Risk:** Medium — orchestrating multiple flows
- **Complexity:** L

#### Step 48: Add conditional redirect to wizard

- **File:** `dashboard/src/App.tsx`
- **Action:** On dashboard load, check onboarding status. If not completed, redirect to `/onboarding`.
- **Complexity:** S

#### Step 49: Add all providers to IntegrationsPage

- **File:** `dashboard/src/pages/Integrations/index.tsx`
- **Action:** Add Bitbucket, AWS, Azure, GCP, Proxmox to PROVIDERS with modals.
- **Complexity:** M

### Phase 4.4: Tests

#### Step 50: Unit tests for Proxmox client — **Complexity:** S
#### Step 51: Unit tests for Bitbucket client — **Complexity:** S
#### Step 52: Integration tests for Bitbucket endpoints — **Complexity:** M
#### Step 53: E2E test for onboarding flow — **Complexity:** M

---

## Database Schema Changes Summary

### New Models

| Model | Table | Phase | Key Fields |
|-------|-------|-------|------------|
| `CloudResource` | `cloud_resources` | 2 | orgId, integrationId, provider, resourceType, resourceId, hostname, ipAddress, region, status, osInfo, serverId, lastSyncedAt |
| `MonitoredEndpoint` | `monitored_endpoints` | 3 | orgId, host, port, label, checkInterval, status, lastCheckedAt, lastStatus, lastResponseMs |

### Modified Models

| Model | Change | Phase |
|-------|--------|-------|
| `Organization` | Add `onboardingCompleted`, `cloudResources`, `monitoredEndpoints` relations | 2, 3, 4 |
| `Integration` | Add `cloudResources` relation | 2 |
| `Server` | Add `cloudResources` reverse relation | 2 |

### New Indexes

| Index | Table | Type |
|-------|-------|------|
| `(orgId, provider, resourceId)` | `cloud_resources` | unique |
| `(serverId)` | `cloud_resources` | btree |
| `(orgId, host, port)` | `monitored_endpoints` | unique |
| `(orgId, status)` | `monitored_endpoints` | btree |

---

## New API Endpoints Summary

| Method | Path | Phase | Auth | Description |
|--------|------|-------|------|-------------|
| GET | `/integrations/github/repos` | 1 | JWT + manage_integrations | List discoverable GitHub repos |
| POST | `/integrations/github/repos/sync` | 1 | JWT + manage_integrations | Sync selected repos |
| DELETE | `/integrations/github/repos/:id/sync` | 1 | JWT + manage_integrations | Unsync a repo |
| GET | `/integrations/gitlab/repos` | 1 | JWT + manage_integrations | List discoverable GitLab repos |
| POST | `/integrations/gitlab/repos/sync` | 1 | JWT + manage_integrations | Sync selected repos |
| DELETE | `/integrations/gitlab/repos/:id/sync` | 1 | JWT + manage_integrations | Unsync a repo |
| POST | `/integrations/aws` | 2 | JWT + manage_integrations | Connect AWS account |
| POST | `/integrations/azure` | 2 | JWT + manage_integrations | Connect Azure account |
| POST | `/integrations/gcp` | 2 | JWT + manage_integrations | Connect GCP account |
| GET | `/integrations/:provider/resources` | 2 | JWT + manage_integrations | List discovered cloud resources |
| POST | `/integrations/:provider/discover` | 2 | JWT + manage_integrations | Trigger manual re-discovery |
| GET | `/servers/unmonitored` | 2 | JWT + view_findings | List instances without agents |
| POST | `/monitoring/domains` | 3 | JWT + manage_integrations | Add endpoints to monitor |
| GET | `/monitoring/domains` | 3 | JWT + view_findings | List monitored endpoints |
| DELETE | `/monitoring/domains/:id` | 3 | JWT + manage_integrations | Remove endpoint |
| POST | `/monitoring/domains/:id/check` | 3 | JWT + trigger_scans | Trigger immediate TLS probe |
| POST | `/integrations/proxmox` | 4 | JWT + manage_integrations | Connect Proxmox |
| GET | `/integrations/bitbucket/repos` | 4 | JWT + manage_integrations | List Bitbucket repos |
| POST | `/integrations/bitbucket/repos/sync` | 4 | JWT + manage_integrations | Sync Bitbucket repos |
| POST | `/integrations/bitbucket/webhook` | 4 | Webhook token | Bitbucket push events |
| GET | `/organizations/me/onboarding-status` | 4 | JWT | Onboarding progress |

---

## New Dashboard Components Summary

| Component | Route | Phase | Description |
|-----------|-------|-------|-------------|
| `RepoSelectionPage` | `/integrations/:provider/repos` | 1 | Searchable checkbox list, bulk select, sync |
| `InfrastructureCoveragePage` | `/infrastructure/coverage` | 2 | Coverage bars, unmonitored servers, install buttons |
| Cloud modals (AWS, Azure, GCP) | Modal on `/integrations` | 2 | Credential input forms |
| `DomainMonitoringPage` | `/monitoring/domains` | 3 | Add/list/remove endpoints, status, check now |
| `OnboardingWizard` | `/onboarding` | 4 | 3-card step wizard for first-time users |
| Bitbucket + Proxmox modals | Modal on `/integrations` | 4 | Connection forms |

---

## New BullMQ Queues

| Queue | Phase | Schedule | Purpose |
|-------|-------|----------|---------|
| `cloud-discovery` | 2 | Every 6 hours (repeatable) | Refresh cloud resource cache |
| `domain-monitoring` | 3 | Per-endpoint (1h/6h/24h) | TLS probe + cert health checks |

---

## New npm Dependencies

| Package | Phase | Purpose |
|---------|-------|---------|
| `@aws-sdk/client-ec2` | 2 | AWS EC2 instance discovery |
| `@aws-sdk/client-sts` | 2 | AWS IAM role assumption |
| `@azure/arm-compute` | 2 | Azure VM listing |
| `@azure/identity` | 2 | Azure service principal auth |
| `@google-cloud/compute` | 2 | GCP Compute Engine listing |

---

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| GitHub/GitLab API rate limits during repo discovery for large orgs | Medium | Cache discovered repos in Redis (5-min TTL). Show stale data with "Refresh" button |
| Cloud provider credentials are sensitive | High | Store encrypted references only. Use IAM roles with read-only permissions. Never return credentials in API responses |
| Agent-to-instance matching false positives (hostname collision) | Medium | Match by cloud instance ID first (highest confidence), then hostname, then IP. Display confidence indicator. Allow manual override |
| TLS probe jobs used for port scanning | Medium | Rate limit domain additions per org. Allow only standard TLS ports by default. Log all probe targets |
| Self-hosted providers with self-signed certs | Low | Display prominent warning in UI. Default `verifySsl: true`. Log all disabled-SSL connections |
| Phase 4 wizard depends on all pillar UIs | Low | Each wizard card works independently. Wizard is skippable. Cards link to existing pages |

---

## Success Criteria

- [ ] User can connect GitHub, see all accessible repos, select and sync them
- [ ] User can connect GitLab (including self-hosted), discover and sync repos
- [ ] Synced repos appear in Assets > Repositories and auto-scan on push
- [ ] User can connect AWS/Azure/GCP and see discovered instances
- [ ] Coverage dashboard shows agent installation gaps with install commands
- [ ] User can add domains for SSL monitoring
- [ ] Domain monitoring runs periodic TLS probes and creates findings
- [ ] Onboarding wizard guides first-time users
- [ ] All new endpoints have Zod validation and auth/RBAC middleware
- [ ] Test coverage >= 80% for all new code
- [ ] No credentials stored in plaintext

---

## Estimated Timeline

| Phase | Steps | Effort | Cumulative |
|-------|-------|--------|------------|
| Phase 1: Repo Selection | 16 | ~2 weeks | 2 weeks |
| Phase 2: Cloud Discovery | 14 | ~2 weeks | 4 weeks |
| Phase 3: Domain Monitoring | 10 | ~1.5 weeks | 5.5 weeks |
| Phase 4: Proxmox + Bitbucket + Wizard | 13 | ~1.5 weeks | 7 weeks |

---

## STORIES.md Task Numbering

These extend the existing STORIES.md structure (Epics 1–15):

| Epic | Name | Phase | Stories |
|------|------|-------|---------|
| **Epic 16** | Onboarding — Repository Selection | 1 | 16.1 GitLab Client, 16.2 Repo Discovery API, 16.3 Repo Selection UI, 16.4 Tests |
| **Epic 17** | Onboarding — Cloud Infrastructure Discovery | 2 | 17.1 Schema, 17.2 Cloud Clients, 17.3 Discovery API, 17.4 Coverage UI, 17.5 Tests |
| **Epic 18** | Onboarding — Domain Monitoring | 3 | 18.1 Schema, 18.2 Monitoring Service, 18.3 Monitoring UI, 18.4 Tests |
| **Epic 19** | Onboarding — Proxmox, Bitbucket & Wizard | 4 | 19.1 Proxmox, 19.2 Bitbucket, 19.3 Wizard, 19.4 Tests |
