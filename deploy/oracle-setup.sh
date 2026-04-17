#!/bin/bash
# =============================================================================
# SecurityCentral — Oracle Cloud Free Tier Setup
#
# Prerequisites:
#   1. Oracle Cloud account (https://cloud.oracle.com/sign-up)
#   2. Create an ARM instance: VM.Standard.A1.Flex (4 OCPU, 24GB RAM)
#      - Image: Ubuntu 22.04 Minimal (aarch64)
#      - Boot volume: 50GB
#      - VCN: default, allow ingress on ports 80, 443, 3000
#   3. SSH into the instance and run this script
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/YOUR_REPO/main/deploy/oracle-setup.sh | bash
#   OR
#   scp deploy/oracle-setup.sh ubuntu@<IP>:~ && ssh ubuntu@<IP> bash oracle-setup.sh
# =============================================================================

set -euo pipefail

echo "=== SecurityCentral Setup on Oracle Cloud ==="
echo ""

# --- 1. System updates ---
echo "[1/6] Updating system packages..."
sudo apt-get update -qq
sudo apt-get upgrade -y -qq

# --- 2. Install Docker ---
echo "[2/6] Installing Docker..."
if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker $USER
  echo "  Docker installed. You may need to log out and back in for group changes."
else
  echo "  Docker already installed."
fi

# --- 3. Install Docker Compose plugin ---
echo "[3/6] Installing Docker Compose..."
if ! docker compose version &> /dev/null; then
  sudo apt-get install -y -qq docker-compose-plugin
fi
docker compose version

# --- 4. Open firewall ports (Oracle iptables) ---
echo "[4/6] Opening firewall ports 80, 443..."
# Oracle Ubuntu images use iptables by default
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 3000 -j ACCEPT
sudo netfilter-persistent save 2>/dev/null || true

# --- 5. Clone repo ---
echo "[5/6] Cloning SecurityCentral..."
if [ ! -d "$HOME/SecurityCentral" ]; then
  echo "  Enter your git repo URL (or paste the directory):"
  read -r REPO_URL
  git clone "$REPO_URL" "$HOME/SecurityCentral"
else
  echo "  Directory exists, pulling latest..."
  cd "$HOME/SecurityCentral" && git pull
fi

cd "$HOME/SecurityCentral"

# --- 6. Configure environment ---
echo "[6/6] Configuring environment..."
if [ ! -f .env ]; then
  # Generate secrets
  JWT_SECRET=$(openssl rand -base64 32)
  MYSQL_ROOT_PW=$(openssl rand -base64 16 | tr -d '=/+')
  MYSQL_PW=$(openssl rand -base64 16 | tr -d '=/+')

  echo "  Enter your domain (e.g., sc.yourdomain.com) or public IP:"
  read -r DOMAIN

  cat > .env <<EOF
DOMAIN=${DOMAIN}
MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PW}
MYSQL_PASSWORD=${MYSQL_PW}
JWT_SECRET=${JWT_SECRET}
EOF

  echo "  .env created with generated secrets."
else
  echo "  .env already exists, skipping."
fi

echo ""
echo "=== Setup complete! ==="
echo ""
echo "To start SecurityCentral:"
echo "  cd ~/SecurityCentral"
echo "  docker compose -f docker-compose.prod.yml up -d --build"
echo ""
echo "To check status:"
echo "  docker compose -f docker-compose.prod.yml ps"
echo "  docker compose -f docker-compose.prod.yml logs -f"
echo ""
echo "Your app will be available at:"
source .env
echo "  https://${DOMAIN}  (if domain is configured)"
echo "  http://$(curl -s ifconfig.me)  (direct IP)"
echo ""
echo "=== Next steps ==="
echo "1. Point your domain DNS A record to: $(curl -s ifconfig.me)"
echo "2. Run: docker compose -f docker-compose.prod.yml up -d --build"
echo "3. Caddy will auto-provision a Let's Encrypt SSL certificate"
echo "4. Open https://${DOMAIN} and register your first account"
