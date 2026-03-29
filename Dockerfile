# Multi-stage build for SecurityCentral Platform API + Worker
# Usage:
#   docker build --target api -t sc-api .
#   docker build --target worker -t sc-worker .
#   docker build --target dashboard -t sc-dashboard .

# ── Base ────────────────────────────────────────────
FROM node:20-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY platform-api/package.json platform-api/
COPY dashboard/package.json dashboard/
RUN npm ci --workspaces --include-workspace-root
COPY . .

# ── Prisma Generate ────────────────────────────────
FROM base AS prisma
WORKDIR /app/platform-api
RUN npx prisma generate

# ── API ─────────────────────────────────────────────
FROM prisma AS api
WORKDIR /app/platform-api
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "--import", "tsx/esm", "src/server.ts"]

# ── Worker ──────────────────────────────────────────
FROM prisma AS worker
WORKDIR /app/platform-api
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "--import", "tsx/esm", "src/worker.ts"]

# ── Dashboard Build ─────────────────────────────────
FROM base AS dashboard-build
WORKDIR /app/dashboard
RUN npm run build

# ── Dashboard Serve (nginx) ─────────────────────────
FROM nginx:alpine AS dashboard
COPY --from=dashboard-build /app/dashboard/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
