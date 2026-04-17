#!/bin/bash
# =============================================================================
# SecurityCentral — GCP Setup Script
#
# Run this ONCE to configure GCP for GitHub Actions deployment.
#
# Prerequisites:
#   1. gcloud CLI installed and authenticated (run: gcloud auth login)
#   2. GCP project: securitycentral-491719
#   3. Billing enabled on the project
#
# Usage:
#   bash deploy/gcp-setup.sh YOUR_GITHUB_USERNAME/SecurityCentral
#
# Example:
#   bash deploy/gcp-setup.sh leducduy/SecurityCentral
# =============================================================================

set -euo pipefail

PROJECT_ID="securitycentral-491719"
REGION="us-east1"
SA_NAME="github-deploy"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
POOL_NAME="github-pool"
PROVIDER_NAME="github-provider"
REGISTRY_NAME="securitycentral"
BUCKET_NAME="sc-dashboard-${PROJECT_ID}"

# GitHub repo (required argument)
REPO="${1:-}"
if [ -z "$REPO" ]; then
  echo "Usage: bash deploy/gcp-setup.sh OWNER/REPO"
  echo "Example: bash deploy/gcp-setup.sh leducduy/SecurityCentral"
  exit 1
fi

echo "============================================"
echo "  SecurityCentral — GCP Setup"
echo "============================================"
echo "  Project:  $PROJECT_ID"
echo "  Region:   $REGION"
echo "  Repo:     $REPO"
echo "============================================"
echo ""

# --- 1. Set project ---
echo "[1/8] Setting active project..."
gcloud config set project "$PROJECT_ID"

# --- 2. Enable APIs ---
echo "[2/8] Enabling required APIs..."
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  storage.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  --quiet

# --- 3. Create service account ---
echo "[3/8] Creating service account..."
gcloud iam service-accounts describe "$SA_EMAIL" &>/dev/null 2>&1 || \
  gcloud iam service-accounts create "$SA_NAME" \
    --display-name="GitHub Actions Deploy" --quiet

# Grant roles
for ROLE in roles/run.admin roles/storage.admin roles/artifactregistry.writer roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="$ROLE" --quiet
done
echo "  Service account: $SA_EMAIL"

# --- 4. Create Artifact Registry ---
echo "[4/8] Creating Artifact Registry..."
gcloud artifacts repositories describe "$REGISTRY_NAME" \
  --location="$REGION" &>/dev/null 2>&1 || \
  gcloud artifacts repositories create "$REGISTRY_NAME" \
    --repository-format=docker \
    --location="$REGION" --quiet
echo "  Registry: ${REGION}-docker.pkg.dev/${PROJECT_ID}/${REGISTRY_NAME}"

# --- 5. Create Workload Identity Pool ---
echo "[5/8] Creating Workload Identity Federation..."
gcloud iam workload-identity-pools describe "$POOL_NAME" \
  --location="global" &>/dev/null 2>&1 || \
  gcloud iam workload-identity-pools create "$POOL_NAME" \
    --location="global" \
    --display-name="GitHub Pool" --quiet

# --- 6. Create OIDC Provider ---
echo "[6/8] Creating OIDC provider..."
gcloud iam workload-identity-pools providers describe "$PROVIDER_NAME" \
  --location="global" \
  --workload-identity-pool="$POOL_NAME" &>/dev/null 2>&1 || \
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_NAME" \
    --location="global" \
    --workload-identity-pool="$POOL_NAME" \
    --display-name="GitHub Provider" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --issuer-uri="https://token.actions.githubusercontent.com" --quiet

# --- 7. Bind GitHub repo to service account ---
echo "[7/8] Binding GitHub repo to service account..."
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
WIF_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_NAME}/providers/${PROVIDER_NAME}"

gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_NAME}/attribute.repository/${REPO}" \
  --quiet

# --- 8. Create GCS bucket for dashboard ---
echo "[8/8] Creating GCS bucket for dashboard..."
gsutil ls -b "gs://${BUCKET_NAME}" &>/dev/null 2>&1 || \
  gsutil mb -p "$PROJECT_ID" -l "$REGION" "gs://${BUCKET_NAME}"
gsutil web set -m index.html -e index.html "gs://${BUCKET_NAME}"
gsutil iam ch allUsers:objectViewer "gs://${BUCKET_NAME}"
echo "  Bucket: gs://${BUCKET_NAME}"

# --- Generate JWT secret ---
JWT_SECRET=$(openssl rand -base64 32)

# --- Output ---
echo ""
echo "============================================"
echo "  Setup complete!"
echo "============================================"
echo ""
echo "Add these GitHub Secrets (repo → Settings → Secrets → Actions):"
echo ""
echo "  GCP_WIF_PROVIDER:"
echo "  $WIF_PROVIDER"
echo ""
echo "  GCP_SERVICE_ACCOUNT:"
echo "  $SA_EMAIL"
echo ""
echo "  TIDB_DATABASE_URL:"
echo "  mysql://3NWHxdJcCdkyWqW.root:YOUR_PASSWORD@gateway01.us-east-1.prod.aws.tidbcloud.com:4000/sys?ssl={\"rejectUnauthorized\":true}"
echo "  (replace YOUR_PASSWORD with your TiDB password)"
echo ""
echo "  JWT_SECRET:"
echo "  $JWT_SECRET"
echo ""
echo "  CORS_ORIGINS:"
echo "  https://storage.googleapis.com"
echo ""
echo "Then push to main to trigger deployment:"
echo "  git push origin main"
echo ""
echo "After deploy, your app will be at:"
echo "  Dashboard: https://storage.googleapis.com/${BUCKET_NAME}/index.html"
echo "  API:       https://sc-api-xxxxx-ue.a.run.app (check Cloud Run console)"
echo "============================================"
