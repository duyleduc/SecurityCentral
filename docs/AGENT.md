# SecurityCentral Infrastructure Agent

The SecurityCentral agent runs on target servers to continuously monitor for OS vulnerabilities, compliance violations, and infrastructure misconfigurations. It communicates with the platform via mTLS.

## What It Monitors

### OS Package Vulnerabilities

Scans installed packages against the vulnerability database.

| OS Family | Detection Method |
|-----------|-----------------|
| Ubuntu / Debian | `dpkg-query` |
| CentOS / RHEL / Rocky / Alma | `rpm` |
| Alpine Linux | `/lib/apk/db/installed` or `apk` |

Findings include package name, installed version, fixed version, CVSS score, and whether a fix is auto-applicable.

### CIS Compliance Benchmarks (30+ checks)

**SSH Hardening (CIS 5.2.x):**
- Root login disabled, empty passwords blocked
- MaxAuthTries <= 4, Protocol 2 only
- X11 forwarding disabled, approved ciphers/MACs only
- Login grace time, client alive settings

**Filesystem Security (CIS 1.x):**
- Disabled modules: cramfs, squashfs, udf
- `/tmp` mount options: nodev, nosuid, noexec
- Sticky bit on world-writable directories

**Network Security (CIS 3.x):**
- IP forwarding disabled, ICMP redirects rejected
- TCP SYN cookies enabled, source-routed packets rejected
- IPv6 router advertisements disabled

**Process/Kernel Security (CIS 1.5.x):**
- ASLR enabled, ptrace scope restricted
- Core dumps restricted, SUID dumpable disabled

**User/Password Policy (CIS 5.4.x, 6.2.x):**
- Password max/min days, warning age
- Inactive account lock, default umask
- No duplicate UIDs/GIDs, root-only UID 0

### Resource Metrics (via heartbeat)

Sent every 60 seconds:
- CPU utilization (%)
- Memory utilization (%)
- Disk utilization (%)
- OS family/version, hostname, agent version

---

## Prerequisites

- Linux server (Ubuntu, Debian, CentOS, RHEL, Alpine)
- Architecture: amd64 or arm64
- Root access (for package scanning and compliance checks)
- Network access to the platform API
- An **API key** with `scan:write` scope

## Creating an API Key

In the SecurityCentral dashboard:

1. Go to **Settings** > **API Keys**
2. Click **Create API Key**
3. Name it (e.g., "Agent Registration")
4. Select scope: `scan:write`
5. Copy the key — it is shown only once

Or via API:

```bash
curl -X POST https://<platform>/api/v1/auth/api-keys \
  -H "Authorization: Bearer <your-jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Agent Registration",
    "scopes": ["scan:write"]
  }'
```

---

## Installation (Recommended)

Use the install script for automated setup:

```bash
curl -fsSL https://install.securitycentral.io | bash -s -- \
  --api-key YOUR_API_KEY \
  --api-url https://<platform-api-host> \
  --environment production
```

### What the script does:

1. Detects OS and architecture
2. Downloads the `sc-agent` binary
3. Generates an ECDSA P-256 key pair
4. Registers with the platform (sends CSR, receives signed certificate)
5. Saves certificates to `/etc/securitycentral/certs/`
6. Creates config at `/etc/securitycentral/agent.yml`
7. Installs and starts a systemd service

### Script options:

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--api-key` | Yes | — | API key for registration |
| `--api-url` | No | `https://api.securitycentral.io` | Platform API URL |
| `--environment` | No | `production` | Environment label (production/staging/development) |
| `--version` | No | `latest` | Agent version to install |

---

## Manual Installation

### 1. Build the agent

```bash
cd go
go build -o sc-agent ./cmd/sc-agent/
```

### 2. Generate a key pair and CSR

```bash
sudo mkdir -p /etc/securitycentral/certs

# Generate ECDSA P-256 private key
openssl ecparam -genkey -name prime256v1 -noout \
  -out /etc/securitycentral/certs/agent.key

# Generate CSR
openssl req -new \
  -key /etc/securitycentral/certs/agent.key \
  -subj "/CN=$(hostname)" \
  -out /tmp/agent.csr

sudo chmod 600 /etc/securitycentral/certs/agent.key
```

### 3. Register with the platform

```bash
CSR=$(cat /tmp/agent.csr)

curl -X POST https://<platform>/api/v1/agents/register \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"hostname\": \"$(hostname)\",
    \"osFamily\": \"ubuntu\",
    \"osVersion\": \"22.04\",
    \"arch\": \"$(uname -m | sed 's/x86_64/amd64/' | sed 's/aarch64/arm64/')\",
    \"environment\": \"production\",
    \"csr\": \"$(echo "$CSR" | sed ':a;N;$!ba;s/\n/\\\\n/g')\"
  }"
```

The response contains:

```json
{
  "data": {
    "agentId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "signedCert": "-----BEGIN CERTIFICATE-----\n...",
    "caCert": "-----BEGIN CERTIFICATE-----\n..."
  }
}
```

Save the certificates:

```bash
# Save signed cert (from response signedCert field)
echo "<signedCert>" > /etc/securitycentral/certs/agent.crt

# Save CA cert (from response caCert field)
echo "<caCert>" > /etc/securitycentral/certs/ca.crt
```

### 4. Create configuration

Create `/etc/securitycentral/agent.yml`:

```yaml
agent_id: "<agentId from registration>"
api_url: "https://<platform-api-host>/api/v1"

tls:
  cert: "/etc/securitycentral/certs/agent.crt"
  key: "/etc/securitycentral/certs/agent.key"
  ca: "/etc/securitycentral/certs/ca.crt"

scan:
  on_startup: true       # Run a scan immediately on start
  interval: 6h           # Scan every 6 hours
  packages: true         # OS package vulnerability scanning
  compliance: true       # CIS benchmark compliance checks

heartbeat:
  interval: 60s          # Send heartbeat every 60 seconds

environment: production  # production | staging | development
```

### 5. Create data directory

```bash
sudo mkdir -p /var/lib/securitycentral/queue
```

### 6. Install as systemd service

Create `/etc/systemd/system/securitycentral-agent.service`:

```ini
[Unit]
Description=SecurityCentral Infrastructure Agent
Documentation=https://docs.securitycentral.io/agent
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
```

```bash
sudo cp sc-agent /usr/local/bin/
sudo systemctl daemon-reload
sudo systemctl enable --now securitycentral-agent
```

---

## How It Works

### Authentication

The agent uses a **three-step authentication model**:

| Step | Method | When |
|------|--------|------|
| Registration | API Key (`X-API-Key` header) | Once, during install |
| Heartbeat | mTLS (client certificate) | Every 60s |
| Finding submission | mTLS (client certificate) | After each scan |

The certificate CN follows the format `ag_<agentId>.agents.securitycentral.io`.

### Heartbeat Loop

Every 60 seconds the agent sends:
- Agent version, hostname, OS info
- Resource usage (CPU, memory, disk %)

The platform responds with **commands**:

| Command | Trigger | Action |
|---------|---------|--------|
| `scan_now` | Manual trigger from dashboard | Execute immediate scan |
| `update_agent` | New agent version available | Download, verify, replace binary, restart |
| `update_vulndb` | New vulnerability data available | Download and apply database update |

### Scan Cycle

1. Agent runs package scan (detects installed packages per OS)
2. Agent runs compliance checks (CIS benchmarks)
3. Findings are deduplicated against existing open findings
4. New findings are submitted to `POST /api/v1/agents/findings` via mTLS
5. Platform auto-resolves findings no longer present (vulnerability fixed)

### Offline Queue

If the platform is unreachable, findings are queued locally:
- Location: `/var/lib/securitycentral/queue/`
- Max queue size: 100 entries
- Retry: exponential backoff (1s to 5m)
- Entries are replayed when connectivity is restored

---

## Managing the Agent

```bash
# Check status
sudo systemctl status securitycentral-agent

# View logs
sudo journalctl -u securitycentral-agent -f

# Restart
sudo systemctl restart securitycentral-agent

# Stop
sudo systemctl stop securitycentral-agent

# Trigger an immediate scan (from the platform dashboard)
# Go to the server detail page and click "Scan Now"
```

### Triggering a scan via API

```bash
curl -X POST https://<platform>/api/v1/agents/<agentId>/scan \
  -H "Authorization: Bearer <jwt>"
```

Or from the dashboard: navigate to the server and click the scan button.

---

## File Layout on Target Server

```
/usr/local/bin/
  sc-agent                          # Agent binary

/etc/securitycentral/
  agent.yml                         # Configuration
  certs/
    agent.key                       # Private key (0600)
    agent.crt                       # Signed certificate
    ca.crt                          # Platform CA certificate

/var/lib/securitycentral/
  vulndb.json                       # Vulnerability database cache
  vulndb.json.version               # Database version tracker
  queue/                            # Offline finding queue

/etc/systemd/system/
  securitycentral-agent.service     # Systemd unit file
```

---

## Severity Mapping

CVSS scores from the vulnerability database are mapped to severity levels:

| CVSS Score | Severity |
|------------|----------|
| 9.0 - 10.0 | Critical |
| 7.0 - 8.9 | High |
| 4.0 - 6.9 | Medium |
| 0.1 - 3.9 | Low |
| 0 | Info |

---

## Troubleshooting

**Agent not appearing in dashboard:**
- Check the agent is running: `systemctl status securitycentral-agent`
- Check logs: `journalctl -u securitycentral-agent -f`
- Verify network connectivity to the platform API
- Verify certificates are valid and not expired

**Heartbeat not updating:**
- Check mTLS certificates exist at the configured paths
- Verify the CA certificate matches the platform CA
- Check firewall rules allow outbound HTTPS

**Scans not producing findings:**
- Check `scan.packages` and `scan.compliance` are `true` in config
- Verify the vulnerability database exists at `/var/lib/securitycentral/vulndb.json`
- Check agent logs for scan errors

**Agent offline (> 5 minutes without heartbeat):**
- The platform marks the server as inactive after 5 minutes
- Restart the agent and check logs for connectivity issues
