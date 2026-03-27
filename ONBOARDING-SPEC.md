# SecurityCentral — Project Onboarding & Resource Discovery Specification

**Version:** 1.0.0
**Status:** Draft
**Extends:** `SPEC.md` §4 (API Endpoints), §8 (Agent Communication), §9 (Integrations)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Onboarding Flows](#2-onboarding-flows)
3. [Code Repository Sync](#3-code-repository-sync)
4. [Infrastructure Discovery](#4-infrastructure-discovery)
5. [SSL & Domain Monitoring](#5-ssl--domain-monitoring)
6. [API Endpoints](#6-api-endpoints)
7. [Data Models](#7-data-models)
8. [Dashboard UI](#8-dashboard-ui)
9. [Security Considerations](#9-security-considerations)

---

## 1. Overview

### Problem

Users need to import their projects, servers, and domains into SecurityCentral before scanning begins. A project-by-project manual import doesn't scale for organizations with hundreds of repos and dozens of servers across multiple cloud providers.

### Solution

**Integration-first with selective sync.** Users connect their source code provider or cloud account once, SecurityCentral discovers all available resources, and users choose which ones to monitor. The agent handles provider-agnostic server scanning.

### Design Principles

- **Connect once, select many** — OAuth/token connection, then checkbox selection
- **Agent-first for infrastructure** — cloud discovery provides visibility, agent does scanning
- **Provider-agnostic** — same experience whether on AWS, Azure, GCP, Proxmox, or bare metal
- **Progressive onboarding** — start with one repo, scale to the full org over time
- **Zero-config defaults** — sensible scan schedules out of the box, customizable per-project

---

## 2. Onboarding Flows

### 2.1 Three Entry Points

| Flow | Source | What Gets Imported | Scanning Method |
|------|--------|--------------------|-----------------|
| **Code Repositories** | GitHub / GitLab / Bitbucket (cloud + self-hosted) | Repositories → code scanning | Platform-side (dependency + secrets) |
| **Infrastructure** | Agent install OR cloud API discovery | Servers → OS package scanning + CIS benchmarks | Agent-side (sc-agent binary) |
| **SSL Monitoring** | Domain list, cloud cert inventory, or auto-discovery | Certificates + endpoints → expiry + chain checks | Platform-side (sc-certmon) |

### 2.2 Onboarding Wizard (First-Time Setup)

```
Step 1: Create Organization
        └─ org name, admin user, plan selection

Step 2: Connect Source Code (optional, skippable)
        └─ GitHub App install / GitLab token / Bitbucket OAuth
        └─ Select repos to scan

Step 3: Install Agent (optional, skippable)
        └─ One-liner install command
        └─ OR connect cloud account for server discovery

Step 4: Add Domains (optional, skippable)
        └─ Enter domains for SSL monitoring
        └─ OR connect AWS for ALB/ACM auto-discovery

Step 5: Dashboard
        └─ First scan results appear within minutes
```

Users can skip any step and return later from Settings → Integrations.

---

## 3. Code Repository Sync

### 3.1 Supported Providers

| Provider | Auth Method | Discovery | Webhooks | Self-Hosted |
|----------|------------|-----------|----------|-------------|
| GitHub | GitHub App (OAuth) | Installation repos API | Push, installation events | GitHub Enterprise ✓ |
| GitLab | Personal/Group Access Token | Projects API | Push events | GitLab CE/EE ✓ |
| Bitbucket | App Password / OAuth2 | Repositories API | Push events | Bitbucket Server ✓ |

### 3.2 Connection Flow

```
┌──────────┐     ┌──────────────┐     ┌──────────────────┐
│  User    │────►│  Connect     │────►│  Provider OAuth/  │
│  clicks  │     │  Provider    │     │  Token Input      │
│  button  │     │  button      │     │                   │
└──────────┘     └──────────────┘     └────────┬─────────┘
                                               │
                                               ▼
                                      ┌──────────────────┐
                                      │  Platform fetches │
                                      │  repo list from   │
                                      │  provider API     │
                                      └────────┬─────────┘
                                               │
                                               ▼
                                      ┌──────────────────┐
                                      │  User selects     │
                                      │  repos to sync    │
                                      │  (checkboxes)     │
                                      └────────┬─────────┘
                                               │
                                               ▼
                                      ┌──────────────────┐
                                      │  Webhooks auto-   │
                                      │  configured,      │
                                      │  first scan runs  │
                                      └──────────────────┘
```

### 3.3 Self-Hosted Provider Support

For GitHub Enterprise and GitLab self-hosted, users provide a custom base URL:

```json
{
  "provider": "gitlab",
  "base_url": "https://gitlab.internal.company.com",
  "access_token": "glpat-..."
}
```

The API client parameterizes the base URL. SSL certificate verification is configurable (allow self-signed for internal instances).

### 3.4 Repository Selection

After connecting a provider, the platform fetches all accessible repositories and presents a selection UI:

- **Search/filter** by name, language, last updated
- **Bulk actions** — "Select All", "Select by Org/Group"
- **Default selection** — none (user must explicitly opt in)
- **Metadata shown** — repo name, owner, language, visibility (public/private), last push date
- **Sync status** — synced/unsynced badge per repo

### 3.5 Scan Configuration Per Repository

After syncing, each repository gets default scan settings that can be customized:

```yaml
# Per-repo settings (stored in integrations config)
scan:
  dependencies: true          # lockfile scanning
  secrets: true               # secret pattern detection
  on_push: true               # scan on every push to default branch
  schedule: "0 6 * * *"       # daily at 6 AM UTC
  fail_on: "high"             # PR check threshold
  auto_fix_prs: true          # create fix PRs for fixable vulns
```

### 3.6 Ongoing Sync

- **New repos** — when user adds repos to the GitHub/GitLab org, they appear as "unsyncable" in the dashboard; user can enable them
- **Deleted repos** — marked as archived in SecurityCentral, findings preserved for compliance
- **Webhook auto-repair** — if webhook delivery fails, platform retries and alerts user

---

## 4. Infrastructure Discovery

### 4.1 Primary Method: Agent Installation (Provider-Agnostic)

The sc-agent binary runs on **any Linux server** regardless of hosting:

| Provider | Works | How |
|----------|-------|-----|
| AWS EC2 | ✓ | Agent install on instance |
| Azure VMs | ✓ | Agent install on VM |
| GCP Compute | ✓ | Agent install on instance |
| Proxmox VMs | ✓ | Agent install on VM |
| Bare metal | ✓ | Agent install directly |
| Any VPS (DigitalOcean, Hetzner, OVH, etc.) | ✓ | Agent install on VPS |
| Docker containers | ✓ | Agent in sidecar or host |

Install command (same for all providers):

```bash
curl -fsSL https://install.securitycentral.io | bash -s -- \
  --api-key sc_live_xxxx \
  --environment production
```

The agent auto-detects:
- OS family and version (`/etc/os-release`)
- Architecture (amd64/arm64)
- Cloud provider (AWS via IMDS, GCP via metadata server, Azure via IMDS)
- Cloud region and instance ID
- Hostname

### 4.2 Secondary Method: Cloud API Discovery

Cloud connectors provide **visibility into unmonitored servers** — they list all instances so users can see coverage gaps.

#### Supported Cloud Providers

| Provider | Auth Method | Resources Discovered | API Used |
|----------|------------|---------------------|----------|
| AWS | IAM role / Access Key | EC2 instances, ECS tasks | `ec2:DescribeInstances`, `ecs:ListTasks` |
| Azure | Service Principal (Client ID + Secret) | Virtual Machines, VMSS | `Microsoft.Compute/virtualMachines` |
| GCP | Service Account Key | Compute Engine instances | `compute.instances.list` |
| Proxmox | API Token | VMs and containers | `GET /api2/json/nodes/{node}/qemu` |

#### Discovery Flow

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ Connect Cloud│────►│ Discover all     │────►│ Show coverage    │
│ Account      │     │ instances/VMs    │     │ dashboard        │
└──────────────┘     └──────────────────┘     └────────┬─────────┘
                                                       │
                                                       ▼
                                              ┌──────────────────┐
                                              │ Per instance:    │
                                              │ • Agent installed│
                                              │   → "Monitored"  │
                                              │ • No agent       │
                                              │   → "Unmonitored"│
                                              │   → [Install]    │
                                              └──────────────────┘
```

#### Coverage Dashboard

```
┌─────────────────────────────────────────────────────────┐
│ Infrastructure Coverage                                  │
│                                                         │
│ Provider        Instances    Agents    Coverage          │
│ ─────────────────────────────────────────────           │
│ AWS us-east-1   12           10        83% ████████░░   │
│ AWS eu-west-1    5            5       100% ██████████   │
│ Azure westeu     8            5        63% ██████░░░░   │
│ Proxmox lab      4            0         0% ░░░░░░░░░░   │
│ Bare metal       3            3       100% ██████████   │
│ ─────────────────────────────────────────────           │
│ Total           32           23        72%              │
│                                                         │
│ [Connect Cloud Account]  [Generate Install Command]      │
└─────────────────────────────────────────────────────────┘
```

### 4.3 Proxmox Support

Proxmox uses a REST API with token-based authentication:

```json
{
  "provider": "proxmox",
  "base_url": "https://proxmox.internal.lab:8006",
  "token_id": "user@pam!sc-discovery",
  "token_secret": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "verify_ssl": false
}
```

Discovery walks all nodes → lists VMs/containers → extracts hostname, IP, OS template, status.

### 4.4 Agent-to-Instance Matching

When a cloud connector discovers instances and agents are also registered, the platform matches them:

- **By cloud instance ID** — `cloudInstanceId` on the server record matches the provider's instance ID
- **By hostname** — fallback matching when cloud metadata isn't available
- **By IP address** — last resort for bare metal / Proxmox VMs

---

## 5. SSL & Domain Monitoring

### 5.1 Three Discovery Methods

| Method | Input | What's Monitored |
|--------|-------|------------------|
| **Manual domains** | User enters `example.com`, `api.example.com:8443` | TLS probe → cert health |
| **Cloud auto-discovery** | AWS ALB/NLB + ACM inventory | Certificates from load balancers |
| **Network scan** | CIDR range or hostname list | Probe all endpoints for TLS |

### 5.2 Manual Domain Monitoring

Users add domains/endpoints to monitor:

```json
POST /api/v1/monitoring/domains
{
  "endpoints": [
    { "host": "example.com", "port": 443 },
    { "host": "api.example.com", "port": 443 },
    { "host": "internal.corp.net", "port": 8443 }
  ],
  "check_interval": "1h",
  "alerts": {
    "expiry_thresholds": [90, 60, 30, 7, 1]
  }
}
```

### 5.3 What Gets Checked

For each monitored endpoint, on every check interval:

| Check | Finding Severity |
|-------|-----------------|
| Certificate expired | Critical |
| Expires within 7 days | Critical |
| Expires within 30 days | High |
| Expires within 60 days | Medium |
| Expires within 90 days | Low |
| RSA key < 2048 bits | High |
| SHA-1 signature | High |
| Self-signed (non-CA) | Medium |
| Incomplete chain | Medium |
| Wildcard certificate | Info |
| Endpoint unreachable | High (uptime) |
| TLS version < 1.2 | High |
| Weak cipher suites | Medium |

### 5.4 Uptime Monitoring (Extension)

Beyond SSL, the TLS probe also verifies endpoint reachability:

- **Connection timeout** (10s) → "endpoint unreachable" finding
- **TLS handshake failure** → "TLS error" finding with error detail
- **Response time tracking** → stored as metric, alertable threshold

This overlaps with uptime monitoring but is scoped to TLS endpoints only (not full HTTP health checks).

---

## 6. API Endpoints

### 6.1 Provider Repository Discovery

```
POST /api/v1/integrations/github
  → Connect GitHub App (existing)

GET  /api/v1/integrations/github/repos
  → List all repos accessible via GitHub installation
  → Returns: [{ id, full_name, language, visibility, default_branch, updated_at, synced }]
  → Paginated, searchable by name

POST /api/v1/integrations/github/repos/sync
  → { repo_ids: ["123", "456"] }
  → Enable selected repos for scanning + configure webhooks

DELETE /api/v1/integrations/github/repos/{id}/sync
  → Disable scanning for a repo (keep historical data)
```

Same pattern for GitLab and Bitbucket:

```
GET  /api/v1/integrations/gitlab/repos
POST /api/v1/integrations/gitlab/repos/sync
GET  /api/v1/integrations/bitbucket/repos
POST /api/v1/integrations/bitbucket/repos/sync
```

### 6.2 Cloud Infrastructure Discovery

```
POST /api/v1/integrations/aws
  → { region, accessKeyId?, roleArn? }
  → Connect AWS account for discovery

POST /api/v1/integrations/azure
  → { tenantId, clientId, clientSecret }

POST /api/v1/integrations/gcp
  → { projectId, serviceAccountKey }

POST /api/v1/integrations/proxmox
  → { baseUrl, tokenId, tokenSecret, verifySsl }

GET  /api/v1/integrations/{provider}/resources
  → List all discovered instances/VMs
  → Returns: [{ instance_id, hostname, ip, region, status, agent_installed, os }]

GET  /api/v1/servers/unmonitored
  → Cloud instances without agents (coverage gaps)
```

### 6.3 Domain Monitoring

```
POST /api/v1/monitoring/domains
  → Add endpoints to monitor
  → { endpoints: [{ host, port }], check_interval }

GET  /api/v1/monitoring/domains
  → List monitored domains with latest check status

DELETE /api/v1/monitoring/domains/{id}
  → Stop monitoring an endpoint

POST /api/v1/monitoring/domains/{id}/check
  → Trigger immediate TLS probe
```

---

## 7. Data Models

### 7.1 Integration Config Extensions

```sql
-- integrations.config JSONB stores provider-specific data:

-- GitHub:
{ "installation_id": "123", "app_id": "456" }

-- GitLab (self-hosted):
{ "access_token": "glpat-...", "base_url": "https://gitlab.corp.com" }

-- AWS:
{ "region": "us-east-1", "role_arn": "arn:aws:iam::123:role/sc-discovery" }

-- Azure:
{ "tenant_id": "...", "client_id": "...", "client_secret_ref": "azure-secret-1" }

-- Proxmox:
{ "base_url": "https://pve:8006", "token_id": "...", "token_secret_ref": "..." }
```

### 7.2 New: Monitored Endpoint Table

```sql
CREATE TABLE monitored_endpoints (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id),
    host            TEXT NOT NULL,
    port            INT NOT NULL DEFAULT 443,
    label           TEXT,                          -- friendly name
    check_interval  TEXT NOT NULL DEFAULT '1h',    -- 1h, 6h, 24h
    status          TEXT NOT NULL DEFAULT 'active', -- active | paused
    last_checked_at TIMESTAMPTZ,
    last_status     TEXT,                          -- healthy | unhealthy | unreachable
    last_response_ms INT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE(org_id, host, port)
);
```

### 7.3 New: Cloud Resource Cache

```sql
CREATE TABLE cloud_resources (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id),
    integration_id  UUID NOT NULL REFERENCES integrations(id),
    provider        TEXT NOT NULL,                 -- aws | azure | gcp | proxmox
    resource_type   TEXT NOT NULL,                 -- ec2 | vm | container
    resource_id     TEXT NOT NULL,                 -- provider-specific instance ID
    hostname        TEXT,
    ip_address      TEXT,
    region          TEXT,
    status          TEXT,                          -- running | stopped | terminated
    os_info         TEXT,
    server_id       UUID REFERENCES servers(id),   -- linked if agent installed
    last_synced_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE(org_id, provider, resource_id)
);
```

---

## 8. Dashboard UI

### 8.1 Onboarding Wizard

First-time users see a setup wizard instead of an empty dashboard:

```
┌─────────────────────────────────────────────────────┐
│  Welcome to SecurityCentral                          │
│                                                     │
│  Let's set up your security monitoring.             │
│                                                     │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │
│  │ 📦 Code     │ │ 🖥️ Servers  │ │ 🔒 SSL      │   │
│  │             │ │             │ │             │   │
│  │ Connect     │ │ Install     │ │ Add domains │   │
│  │ GitHub,     │ │ agent on    │ │ to monitor  │   │
│  │ GitLab, or  │ │ servers or  │ │ certificates│   │
│  │ Bitbucket   │ │ connect     │ │ and uptime  │   │
│  │             │ │ cloud API   │ │             │   │
│  │ [Connect]   │ │ [Install]   │ │ [Add]       │   │
│  └─────────────┘ └─────────────┘ └─────────────┘   │
│                                                     │
│  [Skip for now — go to dashboard]                    │
└─────────────────────────────────────────────────────┘
```

### 8.2 Repository Selection Page

After connecting a provider:

```
┌─────────────────────────────────────────────────────┐
│  Select Repositories to Scan          GitHub ✓       │
│                                                     │
│  🔍 [Search repos...]        [Select All] [None]    │
│                                                     │
│  ☑ acme/web-app          TypeScript    2h ago       │
│  ☑ acme/api-server       Go           5h ago       │
│  ☐ acme/docs             Markdown     3d ago       │
│  ☑ acme/mobile-app       Kotlin       1d ago       │
│  ☐ acme/archived-tool    Python       1y ago       │
│                                                     │
│  3 of 5 selected                                    │
│                                                     │
│  [Sync Selected Repositories]                        │
└─────────────────────────────────────────────────────┘
```

### 8.3 Infrastructure Coverage Page

```
┌─────────────────────────────────────────────────────┐
│  Infrastructure Coverage                    72%      │
│  ████████████████████████░░░░░░░░  23/32 monitored  │
│                                                     │
│  Provider       Region       Instances  Agents       │
│  ─────────────────────────────────────────          │
│  🟧 AWS         us-east-1    12         10    [+2]  │
│  🟧 Azure       westeurope    8          5    [+3]  │
│  🟥 Proxmox     lab           4          0    [+4]  │
│  🟩 Bare metal  —             3          3     ✓    │
│                                                     │
│  Unmonitored Servers:                                │
│  ┌──────────────────────────────────────────┐       │
│  │ i-0abc123  web-03  AWS  running  [Install]│       │
│  │ i-0def456  api-02  AWS  running  [Install]│       │
│  │ vm-102     db-01   PVE  running  [Install]│       │
│  └──────────────────────────────────────────┘       │
│                                                     │
│  [Connect Cloud Account]  [Copy Install Command]     │
└─────────────────────────────────────────────────────┘
```

---

## 9. Security Considerations

### 9.1 Credential Storage

| Credential | Storage | Access |
|-----------|---------|--------|
| GitHub App private key | `GITHUB_APP_PRIVATE_KEY` env var | Platform API only |
| GitLab access tokens | Encrypted in `integrations.config` JSONB | Platform API only |
| AWS IAM credentials | Prefer IAM roles; keys encrypted at rest | Discovery service only |
| Azure service principal | Client secret encrypted | Discovery service only |
| Proxmox API tokens | Encrypted in `integrations.config` | Discovery service only |

### 9.2 Least Privilege

Cloud connector permissions should be **read-only**:

- **AWS**: `ec2:DescribeInstances`, `elbv2:DescribeLoadBalancers`, `acm:DescribeCertificate` (no write)
- **Azure**: `Reader` role on subscription
- **GCP**: `compute.viewer` role
- **Proxmox**: `PVEAuditor` role

### 9.3 Self-Hosted Provider SSL

For self-hosted GitLab/Proxmox instances with self-signed certificates, the integration config supports:

```json
{ "verify_ssl": false }
```

This should display a warning in the UI: "SSL verification is disabled for this connection."

---

## Implementation Priority

| Phase | What | Why |
|-------|------|-----|
| **Phase 1** | Repo selection API + UI for GitHub/GitLab | Unblocks the most common onboarding flow |
| **Phase 2** | AWS + Azure + GCP cloud discovery | Shows coverage gaps for enterprise teams |
| **Phase 3** | Manual domain monitoring (SSL + uptime) | Completes the three-pillar coverage |
| **Phase 4** | Proxmox + Bitbucket + onboarding wizard | Self-hosted and smaller-provider support |
