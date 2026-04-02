# Installing the SecurityCentral Agent

Live platform:

| Service | URL |
|---------|-----|
| API | `https://sc-api-360466791412.us-central1.run.app` |
| Dashboard | Your GCS bucket URL |

---

## Quick Install (2 steps)

### 1. Generate an install token from the dashboard

1. Log in to the dashboard
2. Go to **Assets > Servers**
3. Click **Add Server**
4. Configure: environment, scan packages, scan compliance, scan interval
5. Click **Generate Install Command**
6. Copy the command (token is valid for 1 hour, one-time use)

### 2. Run the command on the target server

```bash
curl -fsSL -o sc-agent https://sc-api-360466791412.us-central1.run.app/v1/agents/download?arch=amd64
chmod +x sc-agent && sudo ./sc-agent install --token sctok_YOUR_TOKEN --api-url https://sc-api-360466791412.us-central1.run.app
```

For ARM servers, use `arch=arm64` in the download URL.

That's it. The binary handles everything:
- Generates an ECDSA P-256 key pair (no openssl needed)
- Creates a CSR and registers with the platform
- Receives and stores signed certificate + CA cert
- Writes config to `/etc/securitycentral/agent.yml`
- Creates and starts a systemd service

Output on success:

```
==> SecurityCentral Agent installed successfully!
    Agent ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    Config:   /etc/securitycentral/agent.yml
    Service:  securitycentral-agent.service

    Check status: sudo systemctl status securitycentral-agent
    View logs:    sudo journalctl -u securitycentral-agent -f
```

The server appears in the dashboard within 60 seconds (first heartbeat).

---

## What Happens After Installation

```
  sc-agent (on server)
    │
    ├── Heartbeat (every 60s, mTLS) ──▶ POST /v1/agents/heartbeat
    │     Reports: CPU, memory, disk, OS info, agent version
    │     Receives: commands (scan_now, update_agent, update_vulndb)
    │
    └── Scan (every 6h or on-demand, mTLS) ──▶ POST /v1/agents/findings
          Runs: OS package scan + CIS compliance checks
          Submits: findings with CVE, CVSS, severity, remediation
```

**Authentication model:**

| Step | Auth Method | When |
|------|------------|------|
| Install/enroll | One-time install token | Once during install |
| Heartbeat + findings | mTLS client certificate | Every heartbeat + scan |

Certificate validity: 1 year. CN format: `ag_<agentId>.agents.securitycentral.io`.

---

## What Gets Scanned

### OS Package Vulnerabilities

| OS | Detection Method |
|----|-----------------|
| Ubuntu / Debian | `dpkg-query` |
| CentOS / RHEL / Rocky / Alma | `rpm` |
| Alpine | `/lib/apk/db/installed` or `apk` |

### CIS Compliance Benchmarks (30+ checks)

- **SSH** (CIS 5.2.x): root login, MaxAuthTries, ciphers, X11 forwarding
- **Filesystem** (CIS 1.x): cramfs/squashfs disabled, /tmp mount options
- **Network** (CIS 3.x): IP forwarding, ICMP redirects, SYN cookies
- **Kernel** (CIS 1.5.x): ASLR, ptrace scope, core dumps
- **Users** (CIS 5.4.x, 6.2.x): password aging, umask, duplicate UIDs

### Severity Mapping

| CVSS Score | Severity |
|------------|----------|
| 9.0 - 10.0 | Critical |
| 7.0 - 8.9 | High |
| 4.0 - 6.9 | Medium |
| 0.1 - 3.9 | Low |

---

## File Layout on Target Server

```
/usr/local/bin/sc-agent                     # Agent binary

/etc/securitycentral/
  agent.yml                                 # Configuration (auto-generated)
  certs/
    agent.key                               # ECDSA P-256 private key (0600)
    agent.crt                               # Signed certificate (1 year)
    ca.crt                                  # Platform CA certificate

/var/lib/securitycentral/
  vulndb.json                               # Vulnerability database cache
  queue/                                    # Offline finding queue (max 100)
```

---

## Managing the Agent

```bash
# Status
sudo systemctl status securitycentral-agent

# Logs
sudo journalctl -u securitycentral-agent -f

# Restart
sudo systemctl restart securitycentral-agent

# Stop
sudo systemctl stop securitycentral-agent

# Uninstall
sudo systemctl stop securitycentral-agent
sudo systemctl disable securitycentral-agent
sudo rm /etc/systemd/system/securitycentral-agent.service
sudo rm /usr/local/bin/sc-agent
sudo rm -rf /etc/securitycentral /var/lib/securitycentral
sudo systemctl daemon-reload
```

### Trigger a scan from the API

```bash
curl -X POST https://sc-api-360466791412.us-central1.run.app/api/v1/agents/<agentId>/scan \
  -H "Authorization: Bearer <jwt>"
```

Or from the dashboard: server detail page > **Scan Now**.

---

## Installing on Multiple Servers

Generate one token per server from the dashboard (tokens are one-time use).

For fleet deployment, automate token creation via the API:

```bash
TOKEN=$(curl -s -X POST https://sc-api-360466791412.us-central1.run.app/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"..."}' \
  | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data']['accessToken'])")

# Create a token for each server
INSTALL_TOKEN=$(curl -s -X POST https://sc-api-360466791412.us-central1.run.app/api/v1/install-tokens \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"environment":"production","scan":{"packages":true,"compliance":true,"interval":"6h"}}' \
  | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data']['token'])")

ssh root@server-01 "curl -fsSL -o /tmp/sc-agent https://sc-api-360466791412.us-central1.run.app/v1/agents/download?arch=amd64 && \
  chmod +x /tmp/sc-agent && /tmp/sc-agent install --token $INSTALL_TOKEN --api-url https://sc-api-360466791412.us-central1.run.app"
```

---

## Alternative: API Key Registration (Legacy)

The original API-key-based flow still works for CI/CD and programmatic use:

```bash
curl -X POST https://sc-api-360466791412.us-central1.run.app/v1/agents/register \
  -H "X-API-Key: sc_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"hostname":"server-01","osFamily":"ubuntu","osVersion":"22.04","arch":"amd64","environment":"production","csr":"..."}'
```

This requires creating an API key with `scan:write` scope in **Settings > API Keys**, plus generating your own CSR with openssl. The token-based flow above is recommended.

---

## Troubleshooting

| Symptom | Check | Fix |
|---------|-------|-----|
| `enrollment failed: API error` | Token expired or already used | Generate a new token from the dashboard |
| `failed to reach API` | Network/firewall issue | Verify outbound HTTPS to `sc-api-360466791412.us-central1.run.app` |
| Agent installed but not in dashboard | Wait 60s for first heartbeat | Check `journalctl -u securitycentral-agent -f` |
| `tls: certificate signed by unknown authority` | CA mismatch | Re-install the agent with a new token |
| No findings after scan | Agent not running as root | Agent needs root to read package databases |
| Agent offline in dashboard | > 5 min without heartbeat | Platform marks inactive; check service status |
| Findings not processing | Worker down | Check worker health (see `docs/WORKER-ONBOARDING.md`) |
