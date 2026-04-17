#!/bin/bash
# =============================================================================
# SecurityCentral — GCP Free Deployment
#
# Architecture:
#   Dashboard  → GCS Bucket (static site, free)
#   API        → Cloud Run (free tier: 2M req/month)
#   Monitor    → Cloud Run (merged into API scheduler = free)
#   MySQL      → TiDB Cloud Serverless (25GB free, external)
#   Agent bins → Served from API /v1/agents/download
#
# Cost: $0/month (all within free tiers)
#
# Prerequisites:
#   1. GCP project with billing enabled
#   2. gcloud CLI installed and authenticated
#   3. TiDB Cloud account (https://tidbcloud.com) — create a free serverless cluster
#   4. TiDB connection string ready
# =============================================================================

set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-}"
REGION="${GCP_REGION:-asia-southeast1}"
BUCKET_NAME="${GCS_BUCKET:-sc-dashboard-${PROJECT_ID}}"
TIDB_URL="${TIDB_DATABASE_URL:-}"
JWT_SECRET="${JWT_SECRET:-$(openssl rand -base64 32)}"

if [ -z "$PROJECT_ID" ]; then
  echo "Required environment variables:"
  echo "  export GCP_PROJECT_ID=my-project-123"
  echo "  export TIDB_DATABASE_URL='mysql://user:pass@gateway.tidbcloud.com:4000/securitycentral?sslaccept=strict'"
  echo "  export GCP_REGION=asia-southeast1  (optional)"
  exit 1
fi

if [ -z "$TIDB_URL" ]; then
  echo ""
  echo "=== TiDB Cloud Setup ==="
  echo "1. Go to https://tidbcloud.com → Create free Serverless cluster"
  echo "2. Database name: securitycentral"
  echo "3. Copy the MySQL connection string"
  echo "4. Set: export TIDB_DATABASE_URL='mysql://...'"
  echo ""
  exit 1
fi

echo "=== SecurityCentral → GCP Free Tier ==="
echo "Project:  $PROJECT_ID"
echo "Region:   $REGION"
echo "Bucket:   $BUCKET_NAME"
echo "DB:       TiDB Cloud"
echo ""

# --- 1. Enable APIs ---
echo "[1/6] Enabling GCP APIs..."
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  storage.googleapis.com \
  --project="$PROJECT_ID" --quiet

# --- 2. Create Artifact Registry ---
echo "[2/6] Creating container registry..."
gcloud artifacts repositories create securitycentral \
  --repository-format=docker \
  --location="$REGION" \
  --project="$PROJECT_ID" --quiet 2>/dev/null || true

REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/securitycentral"

# Auth docker to push
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet 2>/dev/null

# --- 3. Build and push API image ---
echo "[3/6] Building API image..."
docker build --platform linux/amd64 -t "${REGISTRY}/api:latest" ./platform-api
docker push "${REGISTRY}/api:latest"

# --- 4. Deploy API to Cloud Run ---
echo "[4/6] Deploying API to Cloud Run..."

# Build agent binaries for linux/amd64 (Cloud Run runs on amd64)
echo "  Building agent binaries..."
cd sc-agent
GOOS=linux GOARCH=amd64 go build -o bin/sc-agent-linux-amd64 ./cmd/sc-agent
GOOS=linux GOARCH=arm64 go build -o bin/sc-agent-linux-arm64 ./cmd/sc-agent
cd ..

gcloud run deploy sc-api \
  --image="${REGISTRY}/api:latest" \
  --platform=managed \
  --region="$REGION" \
  --allow-unauthenticated \
  --set-env-vars="DATABASE_URL=${TIDB_URL},JWT_SECRET=${JWT_SECRET},NODE_ENV=production,PORT=3000,CORS_ORIGINS=https://storage.googleapis.com" \
  --port=3000 \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=3 \
  --project="$PROJECT_ID" --quiet

API_URL=$(gcloud run services describe sc-api --region="$REGION" --project="$PROJECT_ID" --format='value(status.url)')
echo "  API: $API_URL"

# Update CORS with the bucket URL
gcloud run services update sc-api \
  --region="$REGION" \
  --update-env-vars="CORS_ORIGINS=https://storage.googleapis.com,https://${BUCKET_NAME}.storage.googleapis.com,${API_URL}" \
  --project="$PROJECT_ID" --quiet

# --- 5. Build and deploy dashboard to GCS ---
echo "[5/6] Building dashboard and deploying to GCS..."

cd dashboard
VITE_API_URL="$API_URL" npm run build
cd ..

# Create bucket if needed
gsutil ls -b "gs://${BUCKET_NAME}" 2>/dev/null || \
  gsutil mb -p "$PROJECT_ID" -l "$REGION" "gs://${BUCKET_NAME}"

# Enable static website hosting
gsutil web set -m index.html -e index.html "gs://${BUCKET_NAME}"

# Make bucket public
gsutil iam ch allUsers:objectViewer "gs://${BUCKET_NAME}"

# Upload built files
gsutil -m rsync -r -d dashboard/dist "gs://${BUCKET_NAME}"

# Set cache headers
gsutil -m setmeta -h "Cache-Control:public, max-age=3600" "gs://${BUCKET_NAME}/assets/**"
gsutil -m setmeta -h "Cache-Control:no-cache" "gs://${BUCKET_NAME}/index.html"

DASHBOARD_URL="https://storage.googleapis.com/${BUCKET_NAME}/index.html"

# --- 6. Run Prisma migration on TiDB ---
echo "[6/6] Running database migration..."
cd platform-api
DATABASE_URL="$TIDB_URL" npx prisma db push --accept-data-loss 2>/dev/null || \
  echo "  (Migration may need manual run — TiDB is MySQL-compatible but some DDL may differ)"
cd ..

echo ""
echo "=========================================="
echo "  SecurityCentral deployed!"
echo "=========================================="
echo ""
echo "  Dashboard: $DASHBOARD_URL"
echo "  API:       $API_URL"
echo "  Database:  TiDB Cloud (serverless)"
echo ""
echo "  Agent install command for servers:"
echo "  curl -fsSL -o sc-agent ${API_URL}/v1/agents/download?arch=arm64"
echo "  chmod +x sc-agent && sudo ./sc-agent install --api-url ${API_URL} --token <TOKEN>"
echo ""
echo "  JWT_SECRET=$JWT_SECRET"
echo "  (Save this!)"
echo ""
echo "=== Monthly cost: \$0 ==="
echo "  Cloud Run API:  free (2M req/month)"
echo "  GCS Dashboard:  free (5GB storage)"
echo "  TiDB Cloud:     free (25GB serverless)"
echo "  Artifact Reg:   free (500MB)"
echo "=========================================="
