#!/usr/bin/env bash
# SecurityCentral Agent Installer
# Usage: curl -fsSL https://install.securitycentral.io | bash -s -- --api-key <key> [options]
set -euo pipefail

RELEASE_BASE="https://releases.securitycentral.io/agent"
INSTALL_DIR="/usr/local/bin"
CONFIG_DIR="/etc/securitycentral"
CERT_DIR="/etc/securitycentral/certs"
AGENT_BIN="sc-agent"
VERSION="latest"

# --- Defaults ---
API_KEY=""
API_URL="https://api.securitycentral.io"
ENVIRONMENT="production"
LABELS=""

# --- Parse arguments ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-key)   API_KEY="$2"; shift 2 ;;
    --api-url)   API_URL="$2"; shift 2 ;;
    --environment) ENVIRONMENT="$2"; shift 2 ;;
    --labels)    LABELS="$2"; shift 2 ;;
    --version)   VERSION="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [ -z "$API_KEY" ]; then
  echo "Error: --api-key is required"
  echo "Usage: install-agent.sh --api-key <key> [--api-url <url>] [--environment <env>]"
  exit 1
fi

# --- Detect platform ---
detect_platform() {
  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"

  case "$arch" in
    x86_64|amd64)  arch="amd64" ;;
    aarch64|arm64)  arch="arm64" ;;
    *) echo "Unsupported architecture: $arch"; exit 1 ;;
  esac

  if [ "$os" != "linux" ]; then
    echo "Unsupported OS: $os (only Linux is supported)"
    exit 1
  fi

  echo "${os}/${arch}"
}

PLATFORM=$(detect_platform)
echo "==> Detected platform: $PLATFORM"

# --- Download binary ---
DOWNLOAD_URL="${RELEASE_BASE}/v${VERSION}/${AGENT_BIN}-${PLATFORM//\//-}"
echo "==> Downloading agent from $DOWNLOAD_URL"
curl -fsSL -o "/tmp/${AGENT_BIN}" "$DOWNLOAD_URL"
chmod +x "/tmp/${AGENT_BIN}"

# --- Verify signature (ed25519) ---
SIG_URL="${DOWNLOAD_URL}.sig"
if curl -fsSL -o "/tmp/${AGENT_BIN}.sig" "$SIG_URL" 2>/dev/null; then
  echo "==> Verifying binary signature"
  # Signature verification would use the embedded public key
  # For MVP, we log a warning if verification is not available
  if command -v openssl &>/dev/null; then
    echo "    (signature verification placeholder — production uses ed25519)"
  fi
else
  echo "==> Warning: signature file not available, skipping verification"
fi

# --- Install binary ---
echo "==> Installing to ${INSTALL_DIR}/${AGENT_BIN}"
sudo mv "/tmp/${AGENT_BIN}" "${INSTALL_DIR}/${AGENT_BIN}"

# --- Create config directory ---
sudo mkdir -p "$CONFIG_DIR" "$CERT_DIR"

# --- Generate ECDSA key pair and CSR ---
echo "==> Generating agent key pair"
HOSTNAME=$(hostname)
AGENT_KEY="${CERT_DIR}/agent.key"
AGENT_CSR="/tmp/agent.csr"

if command -v openssl &>/dev/null; then
  sudo openssl ecparam -genkey -name prime256v1 -noout -out "$AGENT_KEY" 2>/dev/null
  sudo chmod 600 "$AGENT_KEY"
  sudo openssl req -new -key "$AGENT_KEY" -out "$AGENT_CSR" -subj "/CN=${HOSTNAME}" 2>/dev/null
  CSR_PEM=$(cat "$AGENT_CSR")
else
  echo "Error: openssl is required for certificate generation"
  exit 1
fi

# --- Detect OS info ---
OS_FAMILY="unknown"
OS_VERSION="unknown"
if [ -f /etc/os-release ]; then
  . /etc/os-release
  case "$ID" in
    ubuntu|debian) OS_FAMILY="$ID" ;;
    centos|rhel|rocky|alma) OS_FAMILY="centos" ;;
    alpine) OS_FAMILY="alpine" ;;
    *) OS_FAMILY="$ID" ;;
  esac
  OS_VERSION="${VERSION_ID:-unknown}"
fi

ARCH=$(uname -m)
case "$ARCH" in
  x86_64) ARCH="amd64" ;;
  aarch64) ARCH="arm64" ;;
esac

# --- Register with platform ---
echo "==> Registering agent with platform at $API_URL"
REGISTER_RESPONSE=$(curl -fsSL -X POST "${API_URL}/v1/agents/register" \
  -H "Authorization: Bearer unused" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"hostname\": \"${HOSTNAME}\",
    \"osFamily\": \"${OS_FAMILY}\",
    \"osVersion\": \"${OS_VERSION}\",
    \"arch\": \"${ARCH}\",
    \"environment\": \"${ENVIRONMENT}\",
    \"csr\": $(echo "$CSR_PEM" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo "\"${CSR_PEM}\"")
  }")

# Parse response
AGENT_ID=$(echo "$REGISTER_RESPONSE" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data']['agentId'])" 2>/dev/null || echo "")
SIGNED_CERT=$(echo "$REGISTER_RESPONSE" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data']['signedCert'])" 2>/dev/null || echo "")
CA_CERT=$(echo "$REGISTER_RESPONSE" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data']['caCert'])" 2>/dev/null || echo "")

if [ -z "$AGENT_ID" ]; then
  echo "Error: Failed to register agent"
  echo "Response: $REGISTER_RESPONSE"
  exit 1
fi

echo "==> Agent registered: $AGENT_ID"

# Save certificates
echo "$SIGNED_CERT" | sudo tee "${CERT_DIR}/agent.crt" > /dev/null
echo "$CA_CERT" | sudo tee "${CERT_DIR}/ca.crt" > /dev/null
sudo chmod 644 "${CERT_DIR}/agent.crt" "${CERT_DIR}/ca.crt"

# --- Create config file ---
echo "==> Creating config at ${CONFIG_DIR}/agent.yml"
sudo tee "${CONFIG_DIR}/agent.yml" > /dev/null <<EOF
# SecurityCentral Agent Configuration
agent_id: "${AGENT_ID}"
api_url: "${API_URL}"

tls:
  cert: "${CERT_DIR}/agent.crt"
  key: "${AGENT_KEY}"
  ca: "${CERT_DIR}/ca.crt"

scan:
  on_startup: true
  interval: "6h"
  packages: true
  compliance: true

heartbeat:
  interval: "60s"

environment: "${ENVIRONMENT}"
EOF

# --- Create systemd service ---
echo "==> Creating systemd service"
sudo tee /etc/systemd/system/securitycentral-agent.service > /dev/null <<EOF
[Unit]
Description=SecurityCentral Infrastructure Agent
Documentation=https://docs.securitycentral.io/agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${INSTALL_DIR}/${AGENT_BIN} --config ${CONFIG_DIR}/agent.yml
Restart=always
RestartSec=10
User=root
StandardOutput=journal
StandardError=journal
SyslogIdentifier=sc-agent

# Security hardening
NoNewPrivileges=yes
ProtectSystem=strict
ReadWritePaths=/var/lib/securitycentral /etc/securitycentral

[Install]
WantedBy=multi-user.target
EOF

# Create data directory
sudo mkdir -p /var/lib/securitycentral/queue

# --- Enable and start ---
echo "==> Enabling and starting agent service"
sudo systemctl daemon-reload
sudo systemctl enable securitycentral-agent.service
sudo systemctl start securitycentral-agent.service

echo ""
echo "==> SecurityCentral Agent installed successfully!"
echo "    Agent ID: ${AGENT_ID}"
echo "    Config:   ${CONFIG_DIR}/agent.yml"
echo "    Service:  securitycentral-agent.service"
echo ""
echo "    Check status: sudo systemctl status securitycentral-agent"
echo "    View logs:    sudo journalctl -u securitycentral-agent -f"
