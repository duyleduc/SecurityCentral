#!/bin/bash
# =============================================================================
# SecurityCentral — GCP Cloud Run Deployment
#
# Architecture:
#   Cloud Run (dashboard)  — static React app via nginx
#   Cloud Run (API)        — Node.js Express
#   Cloud SQL (MySQL 8)    — managed database
#
# Free tier covers Cloud Run. Cloud SQL starts at ~$7/mo.
# For $0: use GCE e2-micro with MySQL in Docker instead of Cloud SQL.
#
# Prerequisites:
#   1. GCP account with billing enabled
#   2. gcloud CLI installed: https://cloud.google.com/sdk/install
#   3. Docker installed locally
# =============================================================================

set -euo pipefail

# --- Configuration ---
PROJECT_ID="${GCP_PROJECT_ID:-}"
REGION="${GCP_REGION:-asia-southeast1}"
DB_INSTANCE="sc-mysql"
DB_PASSWORD="${MYSQL_PASSWORD:-$(openssl rand -base64 16 | tr -d '=/+')}"
JWT_SECRET="${JWT_SECRET:-$(openssl rand -base64 32)}"

if [ -z "$PROJECT_ID" ]; then
  echo "Set GCP_PROJECT_ID first:"
  echo "  export GCP_PROJECT_ID=my-project-123"
  exit 1
fi

echo "=== SecurityCentral → GCP Cloud Run ==="
echo "Project:  $PROJECT_ID"
echo "Region:   $REGION"
echo ""

# --- 1. Enable APIs ---
echo "[1/7] Enabling GCP APIs..."
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  --project="$PROJECT_ID" --quiet

# --- 2. Create Artifact Registry ---
echo "[2/7] Creating container registry..."
gcloud artifacts repositories create securitycentral \
  --repository-format=docker \
  --location="$REGION" \
  --project="$PROJECT_ID" --quiet 2>/dev/null || true

REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/securitycentral"

# --- 3. Create Cloud SQL instance ---
echo "[3/7] Creating Cloud SQL MySQL instance (this takes 5-10 min)..."
gcloud sql instances describe "$DB_INSTANCE" --project="$PROJECT_ID" &>/dev/null || \
gcloud sql instances create "$DB_INSTANCE" \
  --database-version=MYSQL_8_0 \
  --tier=db-f1-micro \
  --region="$REGION" \
  --root-password="$DB_PASSWORD" \
  --storage-size=10GB \
  --storage-auto-increase \
  --project="$PROJECT_ID" --quiet

# Create database and user
gcloud sql databases create securitycentral --instance="$DB_INSTANCE" --project="$PROJECT_ID" --quiet 2>/dev/null || true
gcloud sql users set-password root --host=% --instance="$DB_INSTANCE" --password="$DB_PASSWORD" --project="$PROJECT_ID" --quiet

DB_CONNECTION=$(gcloud sql instances describe "$DB_INSTANCE" --project="$PROJECT_ID" --format='value(connectionName)')
echo "  Connection: $DB_CONNECTION"

# --- 4. Build and push images ---
echo "[4/8] Building and pushing images..."
docker build -t "${REGISTRY}/api:latest" ./platform-api
docker push "${REGISTRY}/api:latest"

docker build -t "${REGISTRY}/dashboard:latest" ./dashboard
docker push "${REGISTRY}/dashboard:latest"

docker build -t "${REGISTRY}/monitor:latest" ./sc-monitor
docker push "${REGISTRY}/monitor:latest"

# --- 5. Deploy API to Cloud Run ---
echo "[5/8] Deploying API..."
gcloud run deploy sc-api \
  --image="${REGISTRY}/api:latest" \
  --platform=managed \
  --region="$REGION" \
  --allow-unauthenticated \
  --add-cloudsql-instances="$DB_CONNECTION" \
  --set-env-vars="DATABASE_URL=mysql://root:${DB_PASSWORD}@localhost:3306/securitycentral,JWT_SECRET=${JWT_SECRET},NODE_ENV=production,PORT=3000" \
  --port=3000 \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=3 \
  --project="$PROJECT_ID" --quiet

API_URL=$(gcloud run services describe sc-api --region="$REGION" --project="$PROJECT_ID" --format='value(status.url)')
echo "  API URL: $API_URL"

# --- 7. Deploy dashboard to Cloud Run ---
echo "[7/8] Deploying dashboard..."
# Rebuild dashboard with API URL baked into nginx proxy
# (Or use Cloud Run's URL routing)
gcloud run deploy sc-dashboard \
  --image="${REGISTRY}/dashboard:latest" \
  --platform=managed \
  --region="$REGION" \
  --allow-unauthenticated \
  --port=80 \
  --memory=256Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=2 \
  --project="$PROJECT_ID" --quiet

DASHBOARD_URL=$(gcloud run services describe sc-dashboard --region="$REGION" --project="$PROJECT_ID" --format='value(status.url)')

# Update API CORS with dashboard URL
gcloud run services update sc-api \
  --region="$REGION" \
  --update-env-vars="CORS_ORIGINS=${DASHBOARD_URL}" \
  --project="$PROJECT_ID" --quiet

# --- 8. Deploy monitor to Cloud Run (always-on, min 1 instance) ---
echo "[8/8] Deploying monitor..."
gcloud run deploy sc-monitor \
  --image="${REGISTRY}/monitor:latest" \
  --platform=managed \
  --region="$REGION" \
  --no-allow-unauthenticated \
  --set-env-vars="SC_API_URL=${API_URL},SC_API_KEY=sc-monitor-key,SC_POLL_INTERVAL=5s" \
  --port=8080 \
  --memory=128Mi \
  --cpu=1 \
  --min-instances=1 \
  --max-instances=1 \
  --no-cpu-throttling \
  --project="$PROJECT_ID" --quiet

echo ""
echo "=== Deployment complete! ==="
echo ""
echo "Dashboard: $DASHBOARD_URL"
echo "API:       $API_URL"
echo ""
echo "=== Next steps ==="
echo "1. Open $DASHBOARD_URL and register"
echo "2. Run Prisma migration:"
echo "   DATABASE_URL='mysql://root:${DB_PASSWORD}@<CLOUD_SQL_IP>/securitycentral' npx prisma migrate deploy"
echo "3. Install agent on servers:"
echo "   curl -fsSL -o sc-agent ${API_URL}/v1/agents/download?arch=arm64"
echo ""
echo "=== Saved credentials ==="
echo "DB_PASSWORD=$DB_PASSWORD"
echo "JWT_SECRET=$JWT_SECRET"
echo "(Save these somewhere safe!)"
