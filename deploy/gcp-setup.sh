#!/bin/bash
# One-time GCP setup for SecurityCentral CI/CD
# Run this locally before your first deploy
#
# Usage: ./deploy/gcp-setup.sh <project-id>

set -euo pipefail

PROJECT_ID="${1:?Usage: $0 <gcp-project-id>}"
REGION="us-central1"
GITHUB_REPO="${2:?Usage: $0 <gcp-project-id> <github-owner/repo>}"

echo "==> Setting up GCP project: $PROJECT_ID"
gcloud config set project "$PROJECT_ID"

# ── Enable APIs ─────────────────────────────────────
echo "==> Enabling APIs..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  containerregistry.googleapis.com \
  storage.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com

# ── Create Secrets ──────────────────────────────────
echo "==> Creating secrets (you'll be prompted for values)..."

create_secret() {
  local name=$1
  local prompt=$2
  if gcloud secrets describe "$name" --project="$PROJECT_ID" &>/dev/null; then
    echo "   Secret '$name' already exists, skipping"
  else
    read -rsp "$prompt: " value
    echo
    echo -n "$value" | gcloud secrets create "$name" --data-file=- --project="$PROJECT_ID"
    echo "   Created secret: $name"
  fi
}

create_secret "DATABASE_URL" "Neon PostgreSQL URL (postgresql://...)"
create_secret "REDIS_URL" "Upstash Redis URL (rediss://...)"
create_secret "JWT_SECRET" "JWT secret (or press enter to auto-generate)"
create_secret "JWT_REFRESH_SECRET" "JWT refresh secret (or press enter to auto-generate)"

# ── Create Dashboard Bucket ─────────────────────────
BUCKET="gs://${PROJECT_ID}-dashboard"
echo "==> Creating dashboard bucket: $BUCKET"
if gsutil ls "$BUCKET" &>/dev/null; then
  echo "   Bucket already exists"
else
  gsutil mb -l "$REGION" "$BUCKET"
  gsutil iam ch allUsers:objectViewer "$BUCKET"
  gsutil web set -m index.html -e index.html "$BUCKET"
fi

# ── Workload Identity Federation (for GitHub Actions) ─
echo "==> Setting up Workload Identity Federation for GitHub Actions..."

# Create a service account for CI/CD
SA_NAME="github-actions"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

if gcloud iam service-accounts describe "$SA_EMAIL" &>/dev/null; then
  echo "   Service account already exists"
else
  gcloud iam service-accounts create "$SA_NAME" \
    --display-name="GitHub Actions"
fi

# Grant roles to the service account
echo "==> Granting IAM roles..."
for role in \
  roles/run.admin \
  roles/storage.admin \
  roles/iam.serviceAccountUser \
  roles/secretmanager.secretAccessor \
  roles/viewer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$SA_EMAIL" \
    --role="$role" \
    --condition=None \
    --quiet
done

# Create Workload Identity Pool
POOL_NAME="github-pool"
PROVIDER_NAME="github-provider"

if gcloud iam workload-identity-pools describe "$POOL_NAME" --location=global &>/dev/null; then
  echo "   WIF pool already exists"
else
  gcloud iam workload-identity-pools create "$POOL_NAME" \
    --location=global \
    --display-name="GitHub Actions Pool"
fi

if gcloud iam workload-identity-pools providers describe "$PROVIDER_NAME" \
  --workload-identity-pool="$POOL_NAME" --location=global &>/dev/null; then
  echo "   WIF provider already exists"
else
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_NAME" \
    --workload-identity-pool="$POOL_NAME" \
    --location=global \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --attribute-condition="assertion.repository=='${GITHUB_REPO}'"
fi

# Allow GitHub Actions to impersonate the SA
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')/locations/global/workloadIdentityPools/${POOL_NAME}/attribute.repository/${GITHUB_REPO}" \
  --quiet

# ── Print GitHub Secrets to configure ───────────────
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
WIF_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_NAME}/providers/${PROVIDER_NAME}"

echo ""
echo "=============================================="
echo "  Setup complete! Add these GitHub Secrets:"
echo "=============================================="
echo ""
echo "  GCP_PROJECT_ID        = $PROJECT_ID"
echo "  WIF_PROVIDER          = $WIF_PROVIDER"
echo "  WIF_SERVICE_ACCOUNT   = $SA_EMAIL"
echo "  DASHBOARD_BUCKET      = ${PROJECT_ID}-dashboard"
echo "  API_URL               = (Cloud Run URL after first deploy)"
echo "  CORS_ORIGINS          = https://storage.googleapis.com"
echo "  DATABASE_URL          = (same as the secret you entered)"
echo "  REDIS_URL             = (same as the secret you entered)"
echo ""
echo "Go to: https://github.com/${GITHUB_REPO}/settings/secrets/actions"
echo ""
