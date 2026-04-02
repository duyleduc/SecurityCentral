# Worker Operations Runbook

Live endpoints:

| Service | URL |
|---------|-----|
| API | `https://sc-api-360466791412.us-central1.run.app` |
| Worker | `https://sc-worker-360466791412.us-central1.run.app` (IAM-protected) |
| Dashboard | GCS bucket (public, served via `storage.googleapis.com`) |

---

## Architecture

```
                  ┌──────────────────────────────┐
  Dashboard SPA   │        Cloud Run             │
  (GCS bucket) ──▶│  sc-api  (:3000)  ──enqueue──│──▶ Upstash Redis
                  │  sc-worker (:3001) ◀─process──│◀──   (BullMQ)
                  └──────────────────────────────┘
                           │           │
                      Neon Postgres   (optional ES)
```

The API enqueues jobs into Redis. The worker dequeues and processes them.
They share the same `DATABASE_URL`, `REDIS_URL`, and `JWT_SECRET`.

---

## What the Worker Processes

| Queue | Concurrency | What it does |
|-------|-------------|-------------|
| `scan-orchestration` | 5 | Runs security scans (SCA, secrets) |
| `finding-ingestion` | 10 | Persists scan results to Postgres |
| `notifications` | 10 | Sends Slack/email alerts |
| `vulndb-sync` | 1 | Syncs NVD vulnerability database |
| `github-pr` | 3 | Creates auto-fix PRs on GitHub |
| `es-sync` | 10 | Replicates findings to Elasticsearch |
| `cloud-discovery` | 1 | Discovers AWS EC2 instances |
| `domain-monitoring` | 10 | Probes endpoints, validates TLS certs |

Plus a **scheduler** that polls every 15s and enqueues endpoint health checks.

---

## Check if it's Running

The worker is behind IAM (`--no-allow-unauthenticated`), so you need a GCP identity:

```bash
# Authenticate first
gcloud auth login

# Health check via IAM proxy
curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  https://sc-worker-360466791412.us-central1.run.app/health
```

Expected response:

```json
{
  "status": "ok",
  "workers": 8,
  "queues": ["scan-orchestration", "finding-ingestion", "notifications", ...],
  "redis": "connected",
  "timestamp": "2026-04-02T19:24:49.468Z"
}
```

If `"redis": "disconnected"` → the Upstash Redis connection is broken.

---

## Deploy / Redeploy

### From CI (push to main)

Push to `main` triggers `.github/workflows/deploy.yml` which:
1. Builds `docker build --target worker` image
2. Pushes to Artifact Registry (`us-central1-docker.pkg.dev`)
3. Runs `prisma migrate deploy`
4. Deploys to Cloud Run with secrets from GCP Secret Manager

### Manual deploy

```bash
# From project root
docker build --target worker -t us-central1-docker.pkg.dev/$PROJECT_ID/docker/sc-worker:latest .
docker push us-central1-docker.pkg.dev/$PROJECT_ID/docker/sc-worker:latest

gcloud run deploy sc-worker \
  --image us-central1-docker.pkg.dev/$PROJECT_ID/docker/sc-worker:latest \
  --region us-central1
```

If schema changed, run migrations first:

```bash
cd platform-api
DATABASE_URL="<neon-connection-string>" npx prisma migrate deploy
```

---

## Cloud Run Configuration

Current production settings (from `deploy.yml`):

```yaml
port: 3001
memory: 512Mi
cpu: 1
min-instances: 1    # Must stay running for BullMQ
max-instances: 1    # Single instance prevents duplicate processing
allow-unauthenticated: false
```

**`min-instances: 1` is critical** — if set to 0, the worker scales to zero and no jobs get processed. BullMQ needs a persistent connection to Redis.

---

## Environment Variables

Set via GCP Secret Manager (referenced in deploy.yml):

| Variable | Source | Notes |
|----------|--------|-------|
| `DATABASE_URL` | Secret Manager | Neon Postgres connection string |
| `REDIS_URL` | Secret Manager | Upstash Redis connection string |
| `JWT_SECRET` | Secret Manager | Must match API |
| `JWT_REFRESH_SECRET` | Secret Manager | Must match API |
| `NODE_ENV` | Env var | `production` |
| `ELASTICSEARCH_URL` | Env var | Empty (ES disabled for POC) |
| `LOG_LEVEL` | Env var | `info` |

### GitHub Secrets (for CI)

```
API_URL             → https://sc-api-360466791412.us-central1.run.app/api/v1
AUTH_URL            → https://sc-api-360466791412.us-central1.run.app/auth
CORS_ORIGINS        → https://storage.googleapis.com
DASHBOARD_BUCKET    → <your-gcs-bucket-name>
DATABASE_URL        → postgresql://...@ep-xxx.neon.tech/neondb?sslmode=require
GCP_PROJECT_ID      → 360466791412
WIF_PROVIDER        → projects/.../providers/...
WIF_SERVICE_ACCOUNT → ...@...iam.gserviceaccount.com
```

---

## Viewing Logs

### Cloud Run logs (production)

```bash
# Stream live logs
gcloud run services logs tail sc-worker --region us-central1

# Or in GCP Console:
# Console > Cloud Run > sc-worker > Logs
```

### Filter by severity

```bash
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="sc-worker" AND severity>=ERROR' \
  --limit 50 --format json
```

### Local development

```bash
make logs-worker            # tail logs/worker.log
# or
cd platform-api && npx tsx watch src/worker.ts
```

---

## Common Operations

### Restart the worker

```bash
# Force a new revision (restarts the container)
gcloud run services update sc-worker --region us-central1 \
  --set-env-vars "RESTART_TRIGGER=$(date +%s)"
```

### Check queue backlog

Connect to Redis (Upstash dashboard or CLI) and inspect:

```bash
# Install bullmq CLI or use redis-cli
redis-cli -u "$REDIS_URL" LLEN bull:scan-orchestration:wait
redis-cli -u "$REDIS_URL" LLEN bull:notifications:wait
```

If queues are growing and the worker is healthy, the jobs may be failing. Check logs for `"Job ... failed"` entries.

### Purge a stuck queue

```bash
redis-cli -u "$REDIS_URL" DEL bull:scan-orchestration:wait
redis-cli -u "$REDIS_URL" DEL bull:scan-orchestration:active
```

**Warning:** This drops queued jobs permanently.

---

## Troubleshooting

| Symptom | Check | Fix |
|---------|-------|-----|
| Jobs not processing | `curl /health` returns `redis: disconnected` | Check Upstash is up, verify `REDIS_URL` in Secret Manager |
| Worker keeps restarting | `gcloud run services logs tail sc-worker` | Look for startup crash — usually a missing env var or DB connection failure |
| Scans queued but never complete | Worker health shows 8 workers but jobs stuck | Check `scan-orchestration` processor logs for errors |
| Notifications not sending | Jobs complete but no Slack/email | Check `notifications` queue logs, verify webhook URLs |
| Domain monitoring not running | No cert expiry alerts | Worker must have `min-instances >= 1` — scheduler only runs in-process |
| 403 on worker health endpoint | Normal — worker is IAM-protected | Use `gcloud auth print-identity-token` as Bearer token |
| ES sync errors in logs | Expected if `ELASTICSEARCH_URL` is empty | Not a problem for POC — findings still in Postgres |
| Cold start after deploy | First health check slow | Normal — Node.js + Prisma init takes 3-5s |

---

## Local Development

```bash
# Start dependencies (Postgres, Redis, OpenSearch)
docker compose up -d

# Start worker with auto-reload
cd platform-api && npx tsx watch src/worker.ts

# Or via Makefile
make start-worker
make logs-worker
make stop-worker
```

The worker reads from `.env` or falls back to defaults:
- `DATABASE_URL` → `postgresql://securitycentral:securitycentral@localhost:5432/securitycentral`
- `REDIS_URL` → `redis://localhost:6379`
- `PORT` → `3000` (overridden to `3001` in production via Cloud Run PORT)
