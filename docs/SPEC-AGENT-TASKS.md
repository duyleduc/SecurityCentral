# sc-agent Task Breakdown

Derived from `SPEC-AGENT.md`. Tasks are grouped by theme, ordered by dependency. Each task includes what to do, which files to change, and acceptance criteria.

---

## Theme A: Binary Signing & Supply Chain Security

### A1. Generate Ed25519 signing keypair

**What:** Create a one-time Ed25519 keypair for signing agent binaries.

**Do:**
1. Write a Go CLI tool at `go/cmd/sc-sign/main.go` that:
   - `sc-sign keygen` — generates Ed25519 keypair, writes `agent-signing.key` (private) and `agent-signing.pub` (public) to stdout or file
   - `sc-sign sign --key <private-key-file> <binary-file>` — writes `<binary-file>.sha256` and `<binary-file>.sig`
   - `sc-sign verify --pub <public-key-file> <binary-file>` — verifies `.sha256` + `.sig`, exits 0 or 1
2. Generate the keypair, store private key securely (document where: CI secret, 1Password, etc.)
3. Store public key in repo at `go/internal/install/signing_pubkey.go` as a compiled-in constant

**Files:**
- New: `go/cmd/sc-sign/main.go`
- New: `go/internal/install/signing_pubkey.go` (embedded public key constant)

**Acceptance criteria:**
- `sc-sign keygen` produces valid Ed25519 keypair
- `sc-sign sign` produces `.sha256` and `.sig` files
- `sc-sign verify` passes for correctly signed binary, fails for tampered binary

---

### A2. Sign binaries in build pipeline

**What:** Integrate signing into `make build-agent` so every release binary has a `.sha256` and `.sig`.

**Do:**
1. Add `make sign-agent` Makefile target that runs `sc-sign sign` for both amd64 and arm64 binaries
2. Update `make build-agent` to call `sign-agent` after compilation (requires `AGENT_SIGNING_KEY` env var)
3. Skip signing if `AGENT_SIGNING_KEY` is not set (local dev builds are unsigned)
4. Update `.github/workflows/deploy.yml` to set `AGENT_SIGNING_KEY` from GitHub secret

**Files:**
- Modify: `Makefile` — add `sign-agent` target
- Modify: `.github/workflows/deploy.yml` — add signing step

**Acceptance criteria:**
- `make build-agent` with `AGENT_SIGNING_KEY` set produces `go/bin/sc-agent-linux-amd64`, `.sha256`, `.sig`
- `make build-agent` without `AGENT_SIGNING_KEY` builds but skips signing (no error)

---

### A3. Serve signatures from download endpoint

**What:** The API download endpoint should also serve `.sha256` and `.sig` files alongside the binary.

**Do:**
1. Add `GET /v1/agents/download/checksum?arch=amd64` — serves `sc-agent-linux-amd64.sha256`
2. Add `GET /v1/agents/download/signature?arch=amd64` — serves `sc-agent-linux-amd64.sig`
3. Both check `go/bin/` for local files first, fall back to CDN redirect

**Files:**
- Modify: `platform-api/src/modules/agents/agents.router.ts` — add two new GET routes

**Acceptance criteria:**
- `curl /v1/agents/download/checksum?arch=amd64` returns SHA-256 checksum
- `curl /v1/agents/download/signature?arch=amd64` returns Ed25519 signature
- Returns 404 if signature files don't exist (unsigned build)

---

### A4. Verify signature in sc-agent update

**What:** `sc-agent update` must verify the downloaded binary's signature before replacing itself. Hard reject if verification fails.

**Do:**
1. Embed the Ed25519 public key in the binary at compile time (`go/internal/install/signing_pubkey.go`)
2. In `selfupdate.go` Update() method:
   - After downloading binary to `/tmp/sc-agent-update`, compute its SHA-256
   - Download `.sha256` from `/v1/agents/download/checksum`, compare
   - Download `.sig` from `/v1/agents/download/signature`
   - Verify `.sig` against computed SHA-256 using embedded public key
   - If any check fails: delete temp file, return error, do NOT replace binary
   - Log clearly: "signature verification failed — update aborted"
3. If signature files are not available (404), reject the update with a clear error: "unsigned binary — cannot verify integrity"

**Files:**
- Modify: `go/internal/agent/selfupdate.go` — rewrite Update() with mandatory verification
- Modify: `go/internal/install/signing_pubkey.go` — embed public key

**Acceptance criteria:**
- `sc-agent update` with correctly signed binary: downloads, verifies, replaces, restarts
- `sc-agent update` with tampered binary: rejects with "signature verification failed"
- `sc-agent update` with missing signatures: rejects with "unsigned binary"
- Current binary is never replaced if verification fails

---

### A5. Verify signature in sc-agent install

**What:** The install flow should also verify the binary it just downloaded before installing to `/usr/local/bin/`.

**Do:**
1. After the user runs `curl -o sc-agent <url>`, the binary is on disk but not yet installed
2. When `sc-agent install --token ...` starts, before doing anything else:
   - Compute SHA-256 of itself (`os.Executable()`)
   - Fetch checksum + signature from `<api-url>/v1/agents/download/checksum` and `.../signature`
   - Verify — if it fails, print a clear warning: "WARNING: This binary could not be verified. It may have been tampered with."
   - Do NOT hard-block install (the user already downloaded it), but log prominently
3. This is defense-in-depth — signing is the main gate, this is the warning system

**Files:**
- Modify: `go/internal/install/install.go` — add self-verification at start of Run()

**Acceptance criteria:**
- Install with signed binary: "Binary signature verified" logged
- Install with unsigned binary: "WARNING: binary could not be verified" logged, install continues
- Install with tampered binary: "WARNING: signature mismatch" logged, install continues with warning

---

### A6. Version monotonicity (prevent downgrade)

**What:** `sc-agent update` should refuse to install an older version than currently running.

**Do:**
1. In `selfupdate.go`, before replacing:
   - Execute the downloaded binary with `--version` flag (or read version from a header/metadata)
   - Compare with current `version` variable (semver comparison)
   - If downloaded version <= current version: abort with "already up to date" or "downgrade not allowed"
2. Add `--force` flag to `sc-agent update` to bypass this check (for intentional rollback)

**Files:**
- Modify: `go/internal/agent/selfupdate.go` — add version comparison
- Modify: `go/cmd/sc-agent/main.go` — add `--force` flag to update command

**Acceptance criteria:**
- `sc-agent update` when already on latest: "Already up to date (v1.1.0)"
- `sc-agent update` when server has older version: aborts with "downgrade not allowed"
- `sc-agent update --force`: bypasses version check

---

## Theme B: Config Split (Identity + Server-Managed)

### B1. Slim down agent.yml to identity-only

**What:** Reduce `agent.yml` to only connection identity fields. Remove scan/heartbeat settings.

**Do:**
1. Update `go/internal/config/agentconfig.go`:
   - Keep: `agent_id`, `api_url`, `tls` (cert/key/ca paths)
   - Remove from struct: `scan`, `heartbeat`, `environment`
   - Remove validation for scan/heartbeat fields
   - Add backward compat: if old fields exist in YAML, ignore them (don't error)
2. Update `go/internal/install/install.go`:
   - Generate minimal `agent.yml` (identity only)
   - Scan config from enrollment response is no longer written to file

**Files:**
- Modify: `go/internal/config/agentconfig.go`
- Modify: `go/internal/install/install.go` — slim config template

**Acceptance criteria:**
- New install creates minimal `agent.yml` (only agent_id, api_url, tls)
- Old `agent.yml` with scan/heartbeat fields loads without error (fields ignored)
- Config struct no longer has scan/heartbeat fields

---

### B2. Add config field to heartbeat response

**What:** The API returns scan/heartbeat/environment settings in the heartbeat response so the agent gets its config from the server.

**Do:**
1. Store agent config in the `servers` table `metadata` JSON field under `metadata.config`:
   ```json
   { "scan": { "packages": true, "compliance": true, "interval": "6h", "onStartup": true },
     "heartbeat": { "interval": "60s" },
     "environment": "production" }
   ```
2. This config is initially set from the install token's `config` field (already happens in `install-tokens.service.ts`)
3. Update `processHeartbeat()` in `agents.service.ts` to include `config` in the response alongside `commands`
4. Update `HeartbeatResponse` type

**Files:**
- Modify: `platform-api/src/modules/agents/agents.service.ts` — return config in heartbeat
- Modify: `platform-api/src/modules/agents/install-tokens.service.ts` — store config in server metadata at enrollment

**Acceptance criteria:**
- Heartbeat response includes `config` object with scan/heartbeat/environment settings
- Config comes from `servers.metadata.config`
- Install token enrollment writes config to server metadata

---

### B3. Agent reads config from heartbeat response

**What:** The Go agent applies scan/heartbeat settings from the heartbeat response instead of from `agent.yml`.

**Do:**
1. Define a `ServerConfig` struct in `go/internal/agent/`:
   ```go
   type ServerConfig struct {
     Scan      ScanConfig      `json:"scan"`
     Heartbeat HeartbeatConfig `json:"heartbeat"`
     Environment string        `json:"environment"`
   }
   ```
2. Parse `config` from heartbeat response
3. On first heartbeat: apply config (set scan interval, heartbeat interval, etc.)
4. On subsequent heartbeats: if config changed, update scheduler intervals
5. Default config (used before first heartbeat succeeds): packages=true, compliance=true, interval=6h, heartbeat=60s
6. Agent starts with defaults → first heartbeat (within 60s) delivers server config

**Files:**
- New: `go/internal/agent/serverconfig.go` — struct + defaults
- Modify: `go/internal/agent/heartbeat.go` — parse config from response, update scheduler
- Modify: `go/internal/agent/scheduler.go` — accept config updates at runtime
- Modify: `go/cmd/sc-agent/main.go` — remove config-dependent fields from startup

**Acceptance criteria:**
- Agent starts with default config
- First heartbeat delivers server config, agent applies it
- Dashboard changes config → next heartbeat picks it up within 60s
- Agent works with no config in heartbeat (uses defaults)

---

### B4. Dashboard: edit server scan settings

**What:** Add a "Settings" section to the server detail page that lets users change scan interval, toggle packages/compliance, etc.

**Do:**
1. Add `PATCH /api/v1/servers/:id/config` endpoint:
   - Auth: JWT
   - Body: `{ scan: { packages, compliance, interval, onStartup }, heartbeat: { interval }, environment }`
   - Updates `servers.metadata.config` in the database
2. Add UI in `ServerDetail`:
   - Expandable "Agent Settings" section
   - Toggle: scan packages, scan compliance
   - Dropdown: scan interval (1h, 6h, 12h, 24h)
   - Save button → PATCH API call
   - "Changes apply within 60 seconds" helper text

**Files:**
- Modify: `platform-api/src/modules/assets/servers.router.ts` — add PATCH config endpoint
- Modify: `dashboard/src/pages/Assets/ServersList.tsx` — add settings UI in ServerDetail
- Modify: `dashboard/src/api/hooks.ts` — add `useUpdateServerConfig()` mutation

**Acceptance criteria:**
- Dashboard shows current agent settings
- User changes scan interval → saved to DB
- Next heartbeat → agent picks up new config
- No SSH required

---

## Theme C: Certificate Lifecycle

### C1. Auto-renew certificate via heartbeat

**What:** Agent detects when its certificate is near expiry and triggers renewal through the heartbeat.

**Do:**
1. In the Go agent heartbeat, check cert expiry:
   - Read cert from file, parse `NotAfter`
   - If less than 30 days remaining: include `renewCert: true` + new CSR in heartbeat payload
2. API `processHeartbeat()`:
   - If `renewCert` is true and CSR is present: sign new cert, return in response as `renewedCert`
   - Update cert records if needed
3. Agent receives renewed cert:
   - Write new cert to `/etc/securitycentral/certs/agent.crt`
   - Next heartbeat uses new cert (mTLS client reloads)

**Files:**
- Modify: `go/internal/agent/heartbeat.go` — check cert expiry, include CSR
- Modify: `platform-api/src/modules/agents/agents.service.ts` — handle cert renewal in heartbeat
- Modify: `platform-api/src/modules/agents/agents.validation.ts` — add renewCert + csr to HeartbeatSchema

**Acceptance criteria:**
- Agent with cert expiring in <30 days: sends renewal CSR
- API signs new cert and returns it
- Agent writes new cert, next heartbeat succeeds
- Agent with cert expiring in >30 days: no renewal action
- Certificate renewal is invisible to the user

---

## Theme D: Update Robustness

### D1. Automatic rollback on crash

**What:** If the new binary crashes on startup (no heartbeat within 2 minutes), automatically restore the backup.

**Do:**
1. Before `systemctl restart`, write a marker file: `/var/lib/securitycentral/.update-pending` containing the `.bak` path and a timestamp
2. In the agent `run` startup (main.go):
   - Check for `.update-pending` marker
   - If present: start a 2-minute watchdog timer
   - After first successful heartbeat: delete marker (update confirmed)
   - If timer expires before heartbeat succeeds: restore `.bak`, restart, log alert
3. Alternative simpler approach: use systemd `ExecStartPre` to check marker age. If marker is >2min old and exists, swap `.bak` back.

**Files:**
- Modify: `go/internal/agent/selfupdate.go` — write `.update-pending` marker before restart
- Modify: `go/cmd/sc-agent/main.go` — watchdog timer on startup
- Modify: `go/internal/install/install.go` — systemd unit file ExecStartPre (if using systemd approach)

**Acceptance criteria:**
- Update succeeds + heartbeat works: marker deleted, `.bak` remains as backup
- Update succeeds + new binary crashes: after 2 min, `.bak` restored, agent restarts on old version
- Normal startup (no marker): no watchdog overhead

---

### D2. sc-agent uninstall command

**What:** Clean uninstall command to remove agent from server.

**Do:**
1. Add `sc-agent uninstall` subcommand:
   - Stop systemd service
   - Disable systemd service
   - Remove systemd unit file
   - Remove binary from `/usr/local/bin/sc-agent`
   - Remove `/etc/securitycentral/` (config + certs)
   - Remove `/var/lib/securitycentral/` (data + queue)
   - Run `systemctl daemon-reload`
2. Require `--confirm` flag to prevent accidental uninstall
3. Mark server as `decommissioned` in platform (POST to a decommission endpoint or via heartbeat)

**Files:**
- New: `go/internal/install/uninstall.go`
- Modify: `go/cmd/sc-agent/main.go` — add uninstall command
- Optional: `platform-api/src/modules/agents/agents.router.ts` — add decommission endpoint

**Acceptance criteria:**
- `sc-agent uninstall` without `--confirm`: prints what will be removed, exits
- `sc-agent uninstall --confirm`: removes all files, stops service
- Server shows as "decommissioned" in dashboard after uninstall

---

## Theme E: Observability & Diagnostics

### E1. sc-agent status command

**What:** Diagnostic command to check agent health without opening the dashboard.

**Do:**
1. Add `sc-agent status` subcommand:
   - Print current version
   - Check if config file exists and is valid
   - Check if cert is valid and show days until expiry
   - Check if systemd service is active
   - Attempt one heartbeat and report result (HTTP status, latency)
   - Print last scan time (from local state file or log)
   - Print cloud provider detection result
   - Print system info summary (CPU, RAM, disk, IPs)
2. Output format: human-readable table, suitable for support/debugging

**Files:**
- New: `go/internal/agent/status.go`
- Modify: `go/cmd/sc-agent/main.go` — add status command

**Acceptance criteria:**
- `sc-agent status` prints all diagnostic info
- Works without root (reads config + cert, skips heartbeat test if no perms)
- Clear error messages for each check that fails

---

### E2. Heartbeat failure logging and local metrics

**What:** Agent should log structured metrics locally for debugging connectivity issues.

**Do:**
1. Track heartbeat success/failure count in memory
2. On every 10th consecutive failure, log at ERROR level with last error
3. Write a simple metrics file at `/var/lib/securitycentral/metrics.json`:
   ```json
   {
     "heartbeatsTotal": 1234,
     "heartbeatsFailed": 5,
     "lastHeartbeat": "2026-04-03T...",
     "lastHeartbeatError": "connection refused",
     "lastScan": "2026-04-03T...",
     "version": "1.1.0",
     "uptime": 86400
   }
   ```
4. `sc-agent status` reads this file for local diagnostics

**Files:**
- New: `go/internal/agent/metrics.go` — local metrics tracking
- Modify: `go/internal/agent/heartbeat.go` — update metrics on success/failure

**Acceptance criteria:**
- Metrics file updated after each heartbeat
- `sc-agent status` reads and displays metrics
- 10 consecutive failures → ERROR log entry

---

## Task Dependency Graph

```
A1 → A2 → A3 → A4 (signing pipeline)
                A4 → A5 (install verification)
                A4 → A6 (version check uses signed metadata)

B1 → B3 (agent reads from heartbeat after config slimmed)
B2 → B3 (API sends config before agent reads it)
B3 → B4 (dashboard edits only useful after agent reads from server)

C1 standalone (can be done anytime)

D1 standalone (can be done anytime, but more valuable after A4)
D2 standalone

E1 standalone
E2 → E1 (status reads metrics)
```

## Suggested Priority Order

| Priority | Task | Reason |
|----------|------|--------|
| P0 | A1, A2, A3, A4 | Security — unsigned binaries running as root is the biggest risk |
| P0 | A6 | Security — prevent downgrade attacks |
| P1 | B1, B2, B3 | Unblocks remote config management + safe updates |
| P1 | C1 | Agents will start failing silently after 1 year |
| P2 | B4 | UX — dashboard config editing |
| P2 | D1 | Reliability — auto-rollback on bad update |
| P2 | E1, E2 | Observability — debugging agent issues |
| P3 | A5 | Defense-in-depth (install verification) |
| P3 | D2 | Convenience — uninstall command |
