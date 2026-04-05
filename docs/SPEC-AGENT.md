# sc-agent Specification

Version: draft-1
Status: Under discussion

---

## 1. Overview

`sc-agent` is a single Go binary that runs on Linux servers to scan for OS vulnerabilities and CIS compliance violations. It communicates with the SecurityCentral platform via mTLS.

**Supported platforms:** Linux amd64, Linux arm64
**Supported OS families:** Ubuntu, Debian, CentOS, RHEL, Rocky, AlmaLinux, Alpine
**Runtime requirements:** Root access, outbound HTTPS to platform API
**Dependencies:** None (statically compiled Go binary)

---

## 2. Binary Structure

### 2.1 Subcommands

| Command | Description | Auth required |
|---------|-------------|--------------|
| `sc-agent install --token <TOKEN> --api-url <URL>` | One-time enrollment + setup | Install token |
| `sc-agent run [--config <path>]` | Normal operation (default) | mTLS cert |
| `sc-agent update` | Download latest binary, verify, replace, restart | mTLS cert (for download) |
| `sc-agent version` | Print current version | None |

Running `sc-agent` without a subcommand is equivalent to `sc-agent run`.

### 2.2 Version

Version is injected at build time via `-ldflags -X main.version=<semver>`.

The canonical version lives in the `AGENT_VERSION` file at the project root. All build targets read from this file.

Format: `MAJOR.MINOR.PATCH` (e.g., `1.1.0`)

---

## 3. Build

### 3.1 Build command

```bash
make build-agent
```

This produces:
- `go/bin/sc-agent-linux-amd64`
- `go/bin/sc-agent-linux-arm64`

Both cross-compiled with `CGO_ENABLED=0` (pure Go, no C dependencies).

### 3.2 Version stamping

The Makefile reads `AGENT_VERSION` and injects it:

```
-ldflags="-s -w -X main.version=$(AGENT_VERSION)"
```

- `-s`: strip symbol table
- `-w`: strip DWARF debug info
- `-X main.version=...`: compile-time version injection

### 3.3 Binary signing (TODO — not yet implemented)

**Problem:** The current download + execute flow has no integrity verification. A compromised API or CDN could serve a malicious binary that runs as root.

**Proposed solution:**

```
Build time:
  1. Build binary
  2. SHA-256 checksum → sc-agent-linux-amd64.sha256
  3. Ed25519 sign the checksum → sc-agent-linux-amd64.sig
  4. Publish: binary + .sha256 + .sig

Update time (in sc-agent update):
  1. Download binary + .sha256 + .sig
  2. Verify SHA-256 of downloaded binary matches .sha256
  3. Verify .sig against .sha256 using embedded Ed25519 public key
  4. REJECT if either check fails — do not replace binary
  5. Only then: backup current → replace → restart
```

**Key management:**
- Ed25519 private key: stored in CI secrets (never in repo, never on servers)
- Ed25519 public key: compiled into the binary at build time via `-X`
- Rotation: new keypair → new binary release with new pubkey → agents update via old pubkey (old key signs the new binary that contains the new key)

**Makefile additions (proposed):**

```makefile
sign-agent:
  sha256sum go/bin/sc-agent-linux-amd64 > go/bin/sc-agent-linux-amd64.sha256
  # Sign with Ed25519 private key (from CI secret / env var)
  sc-sign --key $(AGENT_SIGNING_KEY) go/bin/sc-agent-linux-amd64.sha256 > go/bin/sc-agent-linux-amd64.sig
```

**Decision needed:** Do we implement signing now or defer? The current flow works but is vulnerable to supply chain attacks.

### 3.4 Distribution

| Channel | URL | When |
|---------|-----|------|
| Local dev / self-hosted | `GET /v1/agents/download?arch=amd64` serves from `go/bin/` | Binary exists locally |
| Production CDN | Redirect to `releases.securitycentral.io/agent/v{VERSION}/sc-agent-linux-{arch}` | Default fallback |
| API version endpoint | `GET /v1/agents/version` returns latest version + URLs | Always available |

---

## 4. Installation

### 4.1 Prerequisites

- Linux server (amd64 or arm64)
- Root access (or sudo)
- Outbound HTTPS to platform API
- An install token (generated from dashboard)

### 4.2 User flow

```
Dashboard                          User's terminal                    Platform API
─────────                          ───────────────                    ────────────
  │                                                                        │
  │ Click "Add Server"                                                     │
  │ Configure: env, scan settings                                          │
  │ Click "Generate Install Command"                                       │
  │ ──── POST /api/v1/install-tokens ──────────────────────────────────▶   │
  │ ◀─── { token: "sctok_xxx", expiresAt: ... } ──────────────────────    │
  │                                                                        │
  │ Shows command:                                                         │
  │   curl -o sc-agent <API>/v1/agents/download?arch=amd64                │
  │   chmod +x sc-agent                                                    │
  │   sudo ./sc-agent install --token sctok_xxx --api-url <API>           │
  │                                        │                               │
  │                    User copies & pastes │                               │
  │                                        ▼                               │
  │                              Download binary                           │
  │                              Run install:                              │
  │                              ├─ Detect OS, arch, cloud                 │
  │                              ├─ Generate ECDSA P-256 keypair           │
  │                              ├─ Create CSR                             │
  │                              ├─ POST /v1/agents/enroll ──────────────▶ │
  │                              │    { token, hostname, os, arch,         │
  │                              │      cloud, csr }                       │
  │                              │                                         │
  │                              │ ◀── { agentId, signedCert, caCert,      │
  │                              │       config }                          │
  │                              │                                         │
  │                              ├─ Write certs to /etc/securitycentral/   │
  │                              ├─ Write agent.yml config                 │
  │                              ├─ Copy binary to /usr/local/bin/         │
  │                              ├─ Create systemd service                 │
  │                              └─ Start service                          │
  │                                                                        │
  │                              First heartbeat (60s) ──────────────────▶ │
  │                                                                        │
  │ Server appears in dashboard ◀──────────────────────────────────────── │
```

### 4.3 Install token

| Property | Value |
|----------|-------|
| Format | `sctok_` + 32 bytes base64url |
| Storage | SHA-256 hash in `install_tokens` table |
| TTL | User-configurable, 5–1440 minutes (default: 60) |
| Usage | One-time — marked used on redemption |
| Scope | Tied to organization |
| Config | Embeds: environment, scan settings, labels |

### 4.4 What the install command does

| Step | Action | Can fail? | Rollback |
|------|--------|-----------|----------|
| 1 | Detect platform (hostname, OS, arch) | No | — |
| 2 | Detect cloud provider (IMDS, 1s timeout each) | No (returns empty) | — |
| 3 | Collect system info (kernel, CPU, RAM, disk, IPs) | No (returns defaults) | — |
| 4 | Generate ECDSA P-256 keypair | Rare | — |
| 5 | Create PKCS#10 CSR | Rare | — |
| 6 | POST /v1/agents/enroll with token | Yes (expired/used/invalid token, network) | Exit with error |
| 7 | Write private key (0600) | Yes (permissions) | Exit with error |
| 8 | Write signed cert + CA cert (0644) | Yes (permissions) | Exit with error |
| 9 | Write agent.yml | Yes (permissions) | Exit with error |
| 10 | Create dirs (/var/lib/securitycentral/queue) | Yes (permissions) | Exit with error |
| 11 | Copy binary to /usr/local/bin/sc-agent | Yes (permissions) | Exit with error |
| 12 | Write systemd unit file | Yes (permissions) | Exit with error |
| 13 | systemctl daemon-reload + enable + start | Yes (systemd) | Exit with error |

**No partial rollback.** If step 6+ fails, the user re-runs install with a new token. Previous files are overwritten.

### 4.5 File layout after install

```
/usr/local/bin/sc-agent                           # Binary (0755)

/etc/securitycentral/
  agent.yml                                       # Config (0644)
  certs/
    agent.key                                     # ECDSA P-256 private key (0600)
    agent.crt                                     # Signed X.509 cert, 1 year validity (0644)
    ca.crt                                        # Platform CA certificate (0644)

/var/lib/securitycentral/
  queue/                                          # Offline finding queue

/etc/systemd/system/
  securitycentral-agent.service                   # Systemd unit
```

---

## 5. Configuration

### 5.1 Current: file-based config (agent.yml)

```yaml
# Identity (set at install, never changes)
agent_id: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
api_url: "https://sc-api-360466791412.us-central1.run.app"

tls:
  cert: "/etc/securitycentral/certs/agent.crt"
  key: "/etc/securitycentral/certs/agent.key"
  ca: "/etc/securitycentral/certs/ca.crt"

# Behavior (set at install from dashboard config)
scan:
  on_startup: true
  interval: "6h"
  packages: true
  compliance: true

heartbeat:
  interval: "60s"

environment: "production"
```

### 5.2 Problem: config drift on update

When we release a new agent version that introduces new config fields (e.g., `scan.sast: true`) or removes old ones, existing `agent.yml` files on servers won't have the new fields. This causes:

- New binary reads old config → missing field → crash or unexpected default
- Config format change → parse error → agent won't start
- No way to change scan settings from dashboard without SSH

### 5.3 Proposed: split config into identity + server-managed

**Local config (agent.yml) — immutable after install:**

```yaml
agent_id: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
api_url: "https://sc-api-360466791412.us-central1.run.app"

tls:
  cert: "/etc/securitycentral/certs/agent.crt"
  key: "/etc/securitycentral/certs/agent.key"
  ca: "/etc/securitycentral/certs/ca.crt"
```

This file only contains connection identity. It never needs to change across agent versions.

**Server-managed config — returned in heartbeat response:**

```json
{
  "data": {
    "commands": [...],
    "config": {
      "scan": {
        "packages": true,
        "compliance": true,
        "interval": "6h",
        "onStartup": true
      },
      "heartbeat": {
        "interval": "60s"
      },
      "environment": "production"
    }
  }
}
```

The agent applies this config in-memory on every heartbeat. Dashboard changes take effect within 60 seconds without SSH or restart.

**Benefits:**
- Binary updates never touch config — no version conflicts
- Dashboard can change scan settings remotely
- New features can be toggled server-side per agent
- Rollback is just a binary swap

**Decision needed:** Should we implement the config split now? The current file-based approach works but doesn't scale to remote management.

---

## 6. Runtime Operation

### 6.1 Startup sequence

```
1. Load config from /etc/securitycentral/agent.yml
2. Validate required fields (agent_id, TLS paths)
3. Create HTTP client:
   - HTTPS → mTLS client with agent cert/key/CA
   - HTTP → plain client (dev mode only)
4. Collect static system info (once)
5. Start heartbeat loop (goroutine)
6. Start scan scheduler (goroutine)
7. If scan.on_startup → run initial scan
8. Wait for SIGTERM/SIGINT
```

### 6.2 Heartbeat loop

**Frequency:** Every 60 seconds (configurable)

**Data sent:**

| Category | Fields | Source |
|----------|--------|--------|
| Identity | agentVersion, hostname, osFamily, osVersion | Binary + /etc/os-release |
| Resources | cpuPercent, memoryPercent, diskPercent | /proc/stat, /proc/meminfo, statfs |
| Resources | loadAvg1/5/15, uptimeSecs | /proc/loadavg, /proc/uptime |
| Resources | memUsedMb, memTotalMb, diskUsedGb, diskTotalGb | /proc/meminfo, statfs |
| System | kernel, cpuCores, cpuModel, totalRamMb, totalDiskGb, ipAddresses | Collected once at startup |

**Commands received:**

| Command | Trigger | Action |
|---------|---------|--------|
| `scan_now` | User clicks "Scan Now" in dashboard | Execute immediate scan |
| `update_vulndb` | New vuln DB snapshot available | Download and apply |

Note: `update_agent` was removed from heartbeat commands. Updates are user-initiated only.

### 6.3 Scan cycle

**Frequency:** Every 6 hours (configurable) + on-demand via `scan_now` command

**Scan types:**

| Type | What it does | Data source |
|------|-------------|-------------|
| `infra_packages` | Detect vulnerable OS packages | dpkg/rpm/apk + vuln DB |
| `infra_compliance` | CIS benchmark checks (30+) | sshd_config, procfs, sysfs, /etc/ |

**Finding submission:** POST `/v1/agents/findings` via mTLS

**Offline queue:** If API unreachable, findings queued in `/var/lib/securitycentral/queue/` (max 100 entries, exponential backoff 1s → 5m)

### 6.4 Authentication model

| Operation | Auth method | Credential |
|-----------|------------|------------|
| Install/enroll | One-time token | `sctok_xxx` (expires, single-use) |
| Heartbeat | mTLS | Client certificate signed by platform CA |
| Finding submission | mTLS | Same client certificate |
| VulnDB download | mTLS | Same client certificate |
| Binary download | None | Public endpoint |

**Certificate details:**
- Algorithm: ECDSA P-256
- Validity: 1 year from enrollment
- CN format: `ag_<agentId>.agents.securitycentral.io`
- Issuer: SecurityCentral Agent CA

**Certificate renewal:** Not yet implemented. Agent must be re-installed when cert expires (1 year).

### 6.5 Graceful shutdown

On SIGTERM/SIGINT:
1. Stop scan scheduler timer
2. Wait for in-progress scan to complete (if any)
3. Close heartbeat loop
4. Exit 0

Systemd handles restart (`Restart=always`, `RestartSec=10`).

---

## 7. Update

### 7.1 User-initiated only

Updates are never automatic. The agent does not self-update via heartbeat commands. The user must explicitly trigger an update via:

1. **Dashboard:** Server detail page → "Update Agent" button → copy command
2. **CLI:** SSH into server → `sudo sc-agent update`

### 7.2 Update flow (sc-agent update)

```
1. Load config to get api_url
2. Detect architecture (runtime.GOARCH)
3. Build download URL: <api_url>/v1/agents/download?arch=<arch>
4. Create HTTP client (mTLS or plain)
5. Download new binary to /tmp/sc-agent-update
6. [TODO] Download .sig and verify Ed25519 signature
7. [TODO] Verify SHA-256 checksum
8. [TODO] Check version is newer (prevent downgrade)
9. chmod 0755 temp binary
10. Backup current binary: /usr/local/bin/sc-agent → /usr/local/bin/sc-agent.bak
11. Atomic rename: /tmp/sc-agent-update → /usr/local/bin/sc-agent
12. If rename fails → restore from .bak
13. systemctl restart securitycentral-agent
```

### 7.3 Version notification (dashboard)

The servers list page shows:
- **Agent column** with version chip per server (orange = outdated)
- **Warning banner** when any agents are outdated: *"N servers have an outdated agent. Latest version: vX.Y.Z. Click a server to update."*
- **Server detail** shows "Update to vX.Y.Z" button (orange) when outdated

Version comparison: `server.agentVersion` (from heartbeat) vs `readAgentVersion()` (from `AGENT_VERSION` file).

### 7.4 What update does NOT do

- Does NOT modify `/etc/securitycentral/agent.yml`
- Does NOT modify certificates
- Does NOT re-register the agent
- Does NOT change the agent ID
- Only replaces the binary and restarts the service

### 7.5 Rollback

If the new binary crashes on startup:
- Systemd restarts it (`Restart=always`)
- After 5 failed starts, systemd stops retrying
- Manual rollback: `sudo mv /usr/local/bin/sc-agent.bak /usr/local/bin/sc-agent && sudo systemctl restart securitycentral-agent`

**TODO:** Automatic rollback — if no successful heartbeat within 2 minutes of update, the init system restores from `.bak`.

### 7.6 Security concerns (current)

| Risk | Status | Mitigation |
|------|--------|-----------|
| Compromised API serves malicious binary | OPEN | Ed25519 signing (proposed in 3.3) |
| MITM on binary download | Low | TLS protects transport |
| Downgrade to vulnerable version | OPEN | Version monotonicity check (TODO) |
| Phishing: tricked into running fake command | Medium | Token is one-time + expires, but binary download is unsigned |
| Stolen install token | Low | 1-hour TTL, single-use, org-scoped |
| Expired mTLS certificate | Medium | 1-year validity, no auto-renewal yet |

---

## 8. Data Collection

### 8.1 At install time

| Data | Source | Sent to |
|------|--------|---------|
| Hostname | `os.Hostname()` | `/v1/agents/enroll` |
| OS family/version | `/etc/os-release` | `/v1/agents/enroll` |
| Architecture | `runtime.GOARCH` | `/v1/agents/enroll` |
| Cloud provider/region/instance | IMDS (1s timeout per provider) | `/v1/agents/enroll` |
| System info (kernel, CPU, RAM, disk, IPs) | procfs, net.Interfaces | Logged locally only |
| CSR (contains hostname as CN) | Generated ECDSA P-256 | `/v1/agents/enroll` |

### 8.2 Every heartbeat (60s)

| Data | Source | Stored in |
|------|--------|-----------|
| Agent version | Compiled into binary | `servers.agentVersion` |
| Hostname, OS | `/etc/os-release` | `servers.*` columns |
| CPU % | `/proc/stat` (500ms delta) | `servers.metadata.resourceUsage` |
| Memory % | `/proc/meminfo` | `servers.metadata.resourceUsage` |
| Disk % | `statfs("/")` | `servers.metadata.resourceUsage` |
| Load averages | `/proc/loadavg` | `servers.metadata.resourceUsage` |
| Memory/disk absolute values | `/proc/meminfo`, `statfs` | `servers.metadata.resourceUsage` |
| Uptime | `/proc/uptime` | `servers.metadata.resourceUsage` |
| Kernel, CPU cores/model, RAM, disk, IPs | Collected once at startup | `servers.metadata.systemInfo` |

### 8.3 Every scan (6h)

| Data | Source | Stored in |
|------|--------|-----------|
| Package name + version | dpkg/rpm/apk | `findings` table |
| CVE matches | Local vuln DB | `findings` table |
| CVSS score + vector | NVD | `findings` table |
| CIS compliance results | sshd_config, procfs, /etc/ | `findings` table |

### 8.4 Data NOT collected

- File contents (only package metadata and specific config values)
- User data, application data, database contents
- Environment variables or secrets
- Network traffic or packet captures
- Application logs
- Anything from non-standard paths

---

## 9. Open Questions

1. **Binary signing:** Implement Ed25519 signing now or defer? Current flow is vulnerable to supply chain attacks.

2. **Config split:** Move scan settings to server-managed (heartbeat response) or keep in agent.yml? Impacts remote management and update safety.

3. **Certificate renewal:** Current certs expire after 1 year. Options:
   - Auto-renew via heartbeat (agent sends new CSR when cert is near expiry)
   - Manual re-install
   - Longer validity (5 years)

4. **Version monotonicity:** Should `sc-agent update` refuse to install an older version? Prevents downgrade attacks but blocks rollback.

5. **Automatic rollback:** If new binary crashes (no heartbeat within N minutes), should the agent auto-restore from `.bak`?

6. **Multi-org isolation:** Can one install token be used to register an agent in a different org? (Currently no — token is org-scoped.)

7. **Uninstall command:** Should `sc-agent uninstall` exist or is manual removal sufficient?

8. **Windows/macOS support:** Out of scope for MVP but should the binary structure anticipate it?

---

## 10. Appendix: API Endpoints Summary

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/v1/agents/register` | API key (`scan:write`) | Legacy registration |
| POST | `/v1/agents/enroll` | Install token | Token-based enrollment |
| POST | `/v1/agents/heartbeat` | mTLS | Heartbeat + commands |
| POST | `/v1/agents/findings` | mTLS | Submit scan results |
| GET | `/v1/agents/version` | None | Latest version + URLs |
| GET | `/v1/agents/download?arch=` | None | Download binary |
| GET | `/v1/agents/vulndb/version` | mTLS | VulnDB snapshot version |
| GET | `/v1/agents/vulndb/download` | mTLS | Download VulnDB |
| POST | `/api/v1/install-tokens` | JWT | Create install token (dashboard) |
