# Deploy SecurityCentral on GCP (Free Tier)

This guide deploys SecurityCentral as a POC using only free-tier services.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐
│  Cloud Storage   │     │    Cloud Run     │
│  (Dashboard SPA) │────▶│  API  (sc-api)   │──▶ Neon PostgreSQL (free)
│  Static hosting  │     │  Worker (sc-wkr) │──▶ Upstash Redis (free)
└─────────────────┘     └──────────────────┘
```

No Elasticsearch — all queries fall back to PostgreSQL.

## Cost: $0/month

| Service | Free Tier Limit |
|---------|----------------|
| Cloud Run | 2M requests, 360K GB-sec/month |
| Cloud Storage | 5GB, 50K reads/month |
| Neon Postgres | 0.5GB, 190 compute-hours/month |
| Upstash Redis | 10K commands/day, 256MB |

---

## Step 1: External Services

### 1a. Neon PostgreSQL

1. Sign up at [neon.tech](https://neon.tech) (free, no credit card)
2. Create a project named `securitycentral`
3. Copy the connection string:
   ```
   postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

### 1b. Upstash Redis

1. Sign up at [upstash.com](https://upstash.com) (free, no credit card)
2. Create a Redis database in `us-central1`
3. Copy the connection string:
   ```
   rediss://default:xxx@us1-xxx.upstash.io:6379
   ```

---

## Step 2: GCP Project Setup

```bash
# Install gcloud CLI if needed
# https://cloud.google.com/sdk/docs/install

# Create project
gcloud projects create securitycentral-poc --name="SecurityCentral POC"
gcloud config set project securitycentral-poc

# Enable required APIs
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  containerregistry.googleapis.com \
  storage.googleapis.com
```

---

## Step 3: Generate Secrets

```bash
# JWT secrets
export JWT_SECRET=$(openssl rand -base64 32)
export JWT_REFRESH_SECRET=$(openssl rand -base64 32)

echo "JWT_SECRET=$JWT_SECRET"
echo "JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET"
```

Save these — you'll need them for Cloud Run env vars.

---

## Step 4: Run Database Migrations

```bash
# Set your Neon connection string
export DATABASE_URL="postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require"

# Run migrations locally
cd platform-api
npx prisma migrate deploy
```

---

## Step 5: Build & Deploy API

```bash
# Build API image
docker build --target api -t gcr.io/securitycentral-poc/sc-api .
docker push gcr.io/securitycentral-poc/sc-api

# Deploy to Cloud Run
gcloud run deploy sc-api \
  --image gcr.io/securitycentral-poc/sc-api \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --port 3000 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 2 \
  --set-env-vars "\
NODE_ENV=production,\
DATABASE_URL=$DATABASE_URL,\
REDIS_URL=$REDIS_URL,\
ELASTICSEARCH_URL=,\
JWT_SECRET=$JWT_SECRET,\
JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET,\
CORS_ORIGINS=https://storage.googleapis.com,\
LOG_LEVEL=info"
```

Note the API URL from the output (e.g. `https://sc-api-xxx-uc.a.run.app`).

---

## Step 6: Build & Deploy Worker

```bash
docker build --target worker -t gcr.io/securitycentral-poc/sc-worker .
docker push gcr.io/securitycentral-poc/sc-worker

gcloud run deploy sc-worker \
  --image gcr.io/securitycentral-poc/sc-worker \
  --region us-central1 \
  --platform managed \
  --no-allow-unauthenticated \
  --port 3001 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 1 \
  --max-instances 1 \
  --set-env-vars "\
NODE_ENV=production,\
DATABASE_URL=$DATABASE_URL,\
REDIS_URL=$REDIS_URL,\
ELASTICSEARCH_URL=,\
JWT_SECRET=$JWT_SECRET,\
JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET,\
LOG_LEVEL=info"
```

Worker needs `min-instances=1` to keep BullMQ processing alive.

---

## Step 7: Deploy Dashboard

### 7a. Update API URL in dashboard

Create `dashboard/.env.production`:

```bash
VITE_API_URL=https://sc-api-xxx-uc.a.run.app
```

### 7b. Build the dashboard

```bash
cd dashboard
npm run build
```

### 7c. Create a Cloud Storage bucket & upload

```bash
# Create bucket
gsutil mb -l us-central1 gs://securitycentral-dashboard

# Enable public access
gsutil iam ch allUsers:objectViewer gs://securitycentral-dashboard

# Set as website
gsutil web set -m index.html -e index.html gs://securitycentral-dashboard

# Upload built files
gsutil -m rsync -r -d dist gs://securitycentral-dashboard
```

Dashboard URL: `https://storage.googleapis.com/securitycentral-dashboard/index.html`

### 7d. Update CORS on API

Update the Cloud Run API service to include the dashboard URL in `CORS_ORIGINS`:

```bash
gcloud run services update sc-api \
  --region us-central1 \
  --set-env-vars "CORS_ORIGINS=https://storage.googleapis.com"
```

---

## Step 8: Configure Dashboard API Proxy

The dashboard currently proxies `/api` to the backend via Vite (dev only). For production, update `dashboard/src/api/client.ts` to use the full API URL.

Check how the API client base URL is configured:

```typescript
// If it uses a relative path like '/api/v1', it needs the full URL in production
const BASE_URL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api/v1`
  : '/api/v1';
```

---

## Step 9: Verify

1. Open the dashboard URL in your browser
2. Register a new account
3. Create a project and add a repository
4. Trigger a scan

Check API health:

```bash
curl https://sc-api-xxx-uc.a.run.app/health
```

---

## Updating

```bash
# Rebuild and redeploy API
docker build --target api -t gcr.io/securitycentral-poc/sc-api .
docker push gcr.io/securitycentral-poc/sc-api
gcloud run deploy sc-api --image gcr.io/securitycentral-poc/sc-api --region us-central1

# Rebuild and redeploy Worker
docker build --target worker -t gcr.io/securitycentral-poc/sc-worker .
docker push gcr.io/securitycentral-poc/sc-worker
gcloud run deploy sc-worker --image gcr.io/securitycentral-poc/sc-worker --region us-central1

# Rebuild and redeploy Dashboard
cd dashboard && npm run build
gsutil -m rsync -r -d dist gs://securitycentral-dashboard
```

---

## Limitations (Free Tier)

| Limitation | Impact | Workaround |
|------------|--------|------------|
| No Elasticsearch | Full-text search uses Postgres LIKE (slower) | Fine for POC |
| Upstash 10K cmds/day | ~300 scans/day max | Sufficient for POC |
| Cloud Run cold starts | First request after idle takes 3-5s | Set `min-instances=1` for API if needed (uses more free quota) |
| Neon 190 compute-hrs | ~6 hrs/day of active queries | Fine for POC |
| No WebSocket on Cloud Run | Real-time updates won't work | Use polling instead |

---

## Cleanup

To remove everything:

```bash
gcloud run services delete sc-api --region us-central1
gcloud run services delete sc-worker --region us-central1
gsutil rm -r gs://securitycentral-dashboard
gcloud projects delete securitycentral-poc
```

Then delete your Neon and Upstash projects from their dashboards.
