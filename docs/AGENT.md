# Installing the SecurityCentral Agent on a Server

Live platform:

| Service | URL |
|---------|-----|
| API | `https://sc-api-360466791412.us-central1.run.app` |
| Dashboard | Your GCS bucket URL |

---

## Prerequisites

- Linux server (Ubuntu, Debian, CentOS/RHEL/Rocky/Alma, Alpine)
- Architecture: amd64 or arm64
- Root access
- `openssl` and `curl` installed
- Outbound HTTPS access to the API

---

## Step 1: Create an API Key

You need an API key with `scan:write` scope. Two ways to get one:

### Option A: Via the Dashboard

1. Log in to the dashboard
2. Go to **Settings > API Keys**
3. Click **Create API Key**
4. Name: `Agent - prod-server-01` (or whatever identifies the server)
5. Scope: `scan:write`
6. Copy the key (starts with `sc_live_...`) — shown only once

### Option B: Via curl

First, log in to get a JWT:

```bash
TOKEN=$(curl -s -X POST https://sc-api-360466791412.us-central1.run.app/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"yourpassword"}' \
  | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data']['accessToken'])")

echo $TOKEN
```

Then create the key:

```bash
curl -s -X POST https://sc-api-360466791412.us-central1.run.app/auth/api-keys \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Agent - prod-server-01",
    "scopes": ["scan:write"]
  }'
```

Response:

```json
{
  "data": {
    "id": "uuid",
    "rawKey": "sc_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "keyPrefix": "xxxxxxxx",
    "name": "Agent - prod-server-01",
    "scopes": ["scan:write"],
    "expiresAt": null
  }
}
```

Save `rawKey` — it won't be shown again.

---

## Step 2: Install the Agent

### Option A: One-line Install (Recommended)

SSH into the target server and run:

```bash
curl -fsSL https://raw.githubusercontent.com/<your-org>/SecurityCentral/main/scripts/install-agent.sh | sudo bash -s -- \
  --api-key sc_live_YOUR_KEY_HERE \
  --api-url https://sc-api-360466791412.us-central1.run.app \
  --environment production
```

What this does:
1. Detects OS and architecture
2. Downloads the `sc-agent` binary
3. Generates an ECDSA P-256 key pair
4. Registers with the API (sends CSR, receives signed certificate)
5. Saves certs to `/etc/securitycentral/certs/`
6. Creates config at `/etc/securitycentral/agent.yml`
7. Installs and starts a systemd service

Install script flags:

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--api-key` | Yes | — | API key with `scan:write` scope |
| `--api-url` | Yes (for our deploy) | `https://api.securitycentral.io` | Use `https://sc-api-360466791412.us-central1.run.app` |
| `--environment` | No | `production` | `production`, `staging`, or `development` |
| `--version` | No | `latest` | Agent version to install |

### Option B: Manual Install

If you can't pipe to bash, or need more control:

#### 2a. Build the agent binary

On your build machine:

```bash
cd go
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o sc-agent ./cmd/sc-agent/
```

Copy `sc-agent` to the target server:

```bash
scp sc-agent root@target-server:/usr/local/bin/sc-agent
ssh root@target-server chmod +x /usr/local/bin/sc-agent
```

#### 2b. Generate key pair and CSR (on the target server)

```bash
sudo mkdir -p /etc/securitycentral/certs

# Generate ECDSA P-256 private key
sudo openssl ecparam -genkey -name prime256v1 -noout \
  -out /etc/securitycentral/certs/agent.key
sudo chmod 600 /etc/securitycentral/certs/agent.key

# Generate CSR
openssl req -new \
  -key /etc/securitycentral/certs/agent.key \
  -subj "/CN=$(hostname)" \
  -out /tmp/agent.csr
```

#### 2c. Register the agent

```bash
API_URL="https://sc-api-360466791412.us-central1.run.app"
API_KEY="sc_live_YOUR_KEY_HERE"

CSR_JSON=$(python3 -c "import sys,json; print(json.dumps(open('/tmp/agent.csr').read()))")

RESPONSE=$(curl -fsSL -X POST "${API_URL}/v1/agents/register" \
  -H "Authorization: Bearer unused" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"hostname\": \"$(hostname)\",
    \"osFamily\": \"$(. /etc/os-release && echo $ID)\",
    \"osVersion\": \"$(. /etc/os-release && echo $VERSION_ID)\",
    \"arch\": \"$(uname -m | sed 's/x86_64/amd64/' | sed 's/aarch64/arm64/')\",
    \"environment\": \"production\",
    \"csr\": ${CSR_JSON}
  }")

echo "$RESPONSE" | python3 -m json.tool
```

Expected response:

```json
{
  "data": {
    "agentId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "signedCert": "-----BEGIN CERTIFICATE-----\n...",
    "caCert": "-----BEGIN CERTIFICATE-----\n..."
  }
}
```

#### 2d. Save certificates

```bash
AGENT_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data']['agentId'])")
echo "$RESPONSE" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data']['signedCert'])" \
  | sudo tee /etc/securitycentral/certs/agent.crt > /dev/null
echo "$RESPONSE" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data']['caCert'])" \
  | sudo tee /etc/securitycentral/certs/ca.crt > /dev/null

echo "Agent ID: $AGENT_ID"
```

#### 2e. Create configuration

```bash
sudo tee /etc/securitycentral/agent.yml > /dev/null <<EOF
agent_id: "${AGENT_ID}"
api_url: "https://sc-api-360466791412.us-central1.run.app"

tls:
  cert: "/etc/securitycentral/certs/agent.crt"
  key: "/etc/securitycentral/certs/agent.key"
  ca: "/etc/securitycentral/certs/ca.crt"

scan:
  on_startup: true
  interval: "6h"
  packages: true
  compliance: true

heartbeat:
  interval: "60s"

environment: "production"
EOF
```

#### 2f. Create systemd service

```bash
sudo mkdir -p /var/lib/securitycentral/queue

sudo tee /etc/systemd/system/securitycentral-agent.service > /dev/null <<'EOF'
[Unit]
Description=SecurityCentral Infrastructure Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/sc-agent --config /etc/securitycentral/agent.yml
Restart=always
RestartSec=10
User=root
StandardOutput=journal
StandardError=journal
SyslogIdentifier=sc-agent
NoNewPrivileges=yes
ProtectSystem=strict
ReadWritePaths=/var/lib/securitycentral /etc/securitycentral

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now securitycentral-agent
```

---

## Step 3: Verify

```bash
# Check service is running
sudo systemctl status securitycentral-agent

# Watch logs
sudo journalctl -u securitycentral-agent -f
```

You should see:

```
Started with heartbeat interval 60s
Running initial scan (on_startup=true)
Heartbeat sent: status=200
Scan completed: 12 packages scanned, 3 findings
Findings submitted: created=3, updated=0, resolved=0
```

In the dashboard, the server should appear under **Infrastructure > Servers** within 60 seconds.

---

## How it Works After Installation

```
                    Every 60s                 Every 6h (or on-demand)
                   ┌─────────┐               ┌──────────────┐
  sc-agent ──mTLS──▶ heartbeat ──────────────▶ package scan  │
  (on server)      │ POST /v1/agents/heartbeat│ compliance   │
                   └────┬────┘               │ checks       │
                        │                    └──────┬───────┘
                   commands back:                    │
                   • scan_now                        ▼
                   • update_agent           POST /v1/agents/findings
                   • update_vulndb          (mTLS, auto-dedup)
```

**Authentication model:**

| Step | Method | When |
|------|--------|------|
| Registration | API Key (`X-API-Key` header) | Once, during install |
| All subsequent calls | mTLS (client certificate) | Every heartbeat + scan |

The certificate is valid for **1 year** from registration. CN format: `ag_<agentId>.agents.securitycentral.io`.

---

## What Gets Scanned

### OS Package Vulnerabilities

| OS | Detection Method |
|----|-----------------|
| Ubuntu / Debian | `dpkg-query` |
| CentOS / RHEL / Rocky / Alma | `rpm` |
| Alpine | `/lib/apk/db/installed` or `apk` |

Each finding includes: package name, installed version, fixed version, CVE ID, CVSS score, severity, and whether a fix is auto-applicable.

### CIS Compliance Benchmarks (30+ checks)

- **SSH Hardening** (CIS 5.2.x): root login, MaxAuthTries, ciphers, X11 forwarding
- **Filesystem** (CIS 1.x): cramfs/squashfs disabled, /tmp mount options, sticky bits
- **Network** (CIS 3.x): IP forwarding, ICMP redirects, SYN cookies
- **Kernel** (CIS 1.5.x): ASLR, ptrace scope, core dumps
- **User/Password** (CIS 5.4.x, 6.2.x): password aging, umask, duplicate UIDs

### Resource Metrics (via heartbeat)

Sent every 60 seconds: CPU %, memory %, disk %, OS info, hostname, agent version.

Severity mapping:

| CVSS Score | Severity |
|------------|----------|
| 9.0 - 10.0 | Critical |
| 7.0 - 8.9 | High |
| 4.0 - 6.9 | Medium |
| 0.1 - 3.9 | Low |

---

## File Layout on Target Server

```
/usr/local/bin/
  sc-agent                          # Agent binary

/etc/securitycentral/
  agent.yml                         # Configuration
  certs/
    agent.key                       # Private key (mode 0600)
    agent.crt                       # Signed certificate (1 year)
    ca.crt                          # Platform CA certificate

/var/lib/securitycentral/
  vulndb.json                       # Vulnerability database cache
  vulndb.json.version               # Database version tracker
  queue/                            # Offline finding queue (max 100 entries)
```

If the platform is unreachable, findings are queued locally in `/var/lib/securitycentral/queue/` with exponential backoff (1s → 5m). They replay when connectivity is restored.

---

## Managing the Agent

```bash
# Status
sudo systemctl status securitycentral-agent

# Logs (live)
sudo journalctl -u securitycentral-agent -f

# Logs (last 100 lines)
sudo journalctl -u securitycentral-agent -n 100

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
# Get your JWT
TOKEN="your-access-token"

# Trigger scan for a specific agent
curl -X POST https://sc-api-360466791412.us-central1.run.app/api/v1/agents/<agentId>/scan \
  -H "Authorization: Bearer $TOKEN"
```

Or from the dashboard: go to the server detail page and click **Scan Now**.

---

## Troubleshooting

| Symptom | Check | Fix |
|---------|-------|-----|
| `Failed to register agent` during install | `curl -s https://sc-api-360466791412.us-central1.run.app/health` | Verify API is up; check API key has `scan:write` scope |
| Agent starts but no heartbeat | `journalctl -u securitycentral-agent -f` | Check certificate files exist and match; verify outbound HTTPS to API |
| Server not appearing in dashboard | Wait 60s for first heartbeat | Check agent logs for `Heartbeat sent: status=200` |
| `tls: certificate signed by unknown authority` | CA mismatch | Re-register the agent to get fresh certs |
| `403` or `401` on heartbeat | Certificate expired or invalid | Certificate lasts 1 year; re-register to renew |
| Scans produce no findings | Agent runs as non-root | Agent needs root to read package databases and check CIS benchmarks |
| Agent offline in dashboard (> 5 min) | Network issue or agent crashed | Check `systemctl status`; platform marks inactive after 5 min without heartbeat |
| Findings not syncing | Check worker health | Worker must be running (`min-instances=1`) to process `finding-ingestion` queue |
| `openssl: command not found` during install | Missing dependency | `apt install openssl` or `yum install openssl` |

---

## Installing on Multiple Servers

For fleet deployment, script it:

```bash
#!/bin/bash
# deploy-agents.sh
API_KEY="sc_live_YOUR_KEY_HERE"
API_URL="https://sc-api-360466791412.us-central1.run.app"
SERVERS=(
  "root@web-01"
  "root@web-02"
  "root@db-01"
  "root@worker-01"
)

for SERVER in "${SERVERS[@]}"; do
  echo "==> Installing agent on $SERVER"
  ssh "$SERVER" "curl -fsSL https://raw.githubusercontent.com/<your-org>/SecurityCentral/main/scripts/install-agent.sh | sudo bash -s -- \
    --api-key $API_KEY \
    --api-url $API_URL \
    --environment production"
done
```

Or use Ansible/Terraform — the install script is idempotent (re-running re-registers with a new agent ID and fresh certificates).
