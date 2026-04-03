.PHONY: dev start stop restart status logs logs-api logs-worker logs-dashboard test lint build docker-up docker-down migrate clean

ROOT_DIR := $(shell pwd)
PID_DIR := $(ROOT_DIR)/.pids
LOG_DIR := $(ROOT_DIR)/logs
AGENT_VERSION := $(shell cat $(ROOT_DIR)/AGENT_VERSION | tr -d '[:space:]')
GO_LDFLAGS := -s -w -X main.version=$(AGENT_VERSION)
API_PID := $(PID_DIR)/api.pid
WORKER_PID := $(PID_DIR)/worker.pid
DASHBOARD_PID := $(PID_DIR)/dashboard.pid

# ── Start / Stop ────────────────────────────────────────────

start: docker-up _ensure_pid_dir start-api start-worker start-dashboard
	@echo ""
	@echo "✓ All services started"
	@echo "  Platform API:  http://localhost:3000"
	@echo "  API Docs:      http://localhost:3000/docs"
	@echo "  Dashboard:     http://localhost:5173"
	@echo "  Worker:        health on :3001"
	@echo ""
	@echo "  Run 'make status' to check, 'make stop' to stop all"

start-api: _ensure_pid_dir
	@if [ -f $(API_PID) ] && kill -0 $$(cat $(API_PID)) 2>/dev/null; then \
		echo "→ API already running (PID $$(cat $(API_PID)))"; \
	else \
		echo "→ Starting platform-api..."; \
		cd $(ROOT_DIR)/platform-api && nohup npx tsx watch src/server.ts > $(LOG_DIR)/api.log 2>&1 & echo $$! > $(API_PID); \
		sleep 0.5; \
		echo "  PID: $$(cat $(API_PID))"; \
	fi

start-worker: _ensure_pid_dir
	@if [ -f $(WORKER_PID) ] && kill -0 $$(cat $(WORKER_PID)) 2>/dev/null; then \
		echo "→ Worker already running (PID $$(cat $(WORKER_PID)))"; \
	else \
		echo "→ Starting worker..."; \
		cd $(ROOT_DIR)/platform-api && nohup npx tsx watch src/worker.ts > $(LOG_DIR)/worker.log 2>&1 & echo $$! > $(WORKER_PID); \
		sleep 0.5; \
		echo "  PID: $$(cat $(WORKER_PID))"; \
	fi

start-dashboard: _ensure_pid_dir
	@if [ -f $(DASHBOARD_PID) ] && kill -0 $$(cat $(DASHBOARD_PID)) 2>/dev/null; then \
		echo "→ Dashboard already running (PID $$(cat $(DASHBOARD_PID)))"; \
	else \
		echo "→ Starting dashboard..."; \
		cd $(ROOT_DIR)/dashboard && nohup npx vite --port 5173 > $(LOG_DIR)/dashboard.log 2>&1 & echo $$! > $(DASHBOARD_PID); \
		sleep 0.5; \
		echo "  PID: $$(cat $(DASHBOARD_PID))"; \
	fi

stop: stop-dashboard stop-worker stop-api
	@echo "✓ All services stopped"

stop-api:
	@if [ -f $(API_PID) ]; then \
		echo "→ Stopping API (PID $$(cat $(API_PID)))..."; \
		kill -- -$$(cat $(API_PID)) 2>/dev/null || kill $$(cat $(API_PID)) 2>/dev/null || true; \
		rm -f $(API_PID); \
	fi
	@lsof -ti:3000 | xargs kill -9 2>/dev/null || true

stop-worker:
	@if [ -f $(WORKER_PID) ]; then \
		echo "→ Stopping Worker (PID $$(cat $(WORKER_PID)))..."; \
		kill -- -$$(cat $(WORKER_PID)) 2>/dev/null || kill $$(cat $(WORKER_PID)) 2>/dev/null || true; \
		rm -f $(WORKER_PID); \
	fi
	@lsof -ti:3001 | xargs kill -9 2>/dev/null || true

stop-dashboard:
	@if [ -f $(DASHBOARD_PID) ]; then \
		echo "→ Stopping Dashboard (PID $$(cat $(DASHBOARD_PID)))..."; \
		kill -- -$$(cat $(DASHBOARD_PID)) 2>/dev/null || kill $$(cat $(DASHBOARD_PID)) 2>/dev/null || true; \
		rm -f $(DASHBOARD_PID); \
	fi
	@lsof -ti:5173 | xargs kill -9 2>/dev/null || true

restart: stop start

status:
	@echo "=== SecurityCentral Services ==="
	@echo ""
	@printf "  %-12s " "API:"; \
	if [ -f $(API_PID) ] && kill -0 $$(cat $(API_PID)) 2>/dev/null; then \
		echo "✓ running (PID $$(cat $(API_PID)))"; \
	else echo "✗ stopped"; fi
	@printf "  %-12s " "Worker:"; \
	if [ -f $(WORKER_PID) ] && kill -0 $$(cat $(WORKER_PID)) 2>/dev/null; then \
		echo "✓ running (PID $$(cat $(WORKER_PID)))"; \
	else echo "✗ stopped"; fi
	@printf "  %-12s " "Dashboard:"; \
	if [ -f $(DASHBOARD_PID) ] && kill -0 $$(cat $(DASHBOARD_PID)) 2>/dev/null; then \
		echo "✓ running (PID $$(cat $(DASHBOARD_PID)))"; \
	else echo "✗ stopped"; fi
	@echo ""
	@printf "  %-12s " "PostgreSQL:"; docker compose ps --format '{{.Status}}' postgres 2>/dev/null | head -1 || echo "not running"
	@printf "  %-12s " "Redis:"; docker compose ps --format '{{.Status}}' redis 2>/dev/null | head -1 || echo "not running"
	@printf "  %-12s " "OpenSearch:"; docker compose ps --format '{{.Status}}' opensearch 2>/dev/null | head -1 || echo "not running"

logs-api:
	@tail -100f $(LOG_DIR)/api.log

logs-worker:
	@tail -100f $(LOG_DIR)/worker.log

logs-dashboard:
	@tail -100f $(LOG_DIR)/dashboard.log

logs:
	@tail -100f $(LOG_DIR)/api.log $(LOG_DIR)/worker.log $(LOG_DIR)/dashboard.log

# ── Dev (foreground — old behavior) ─────────────────────────

dev: docker-up
	@echo "Starting all services in foreground (Ctrl+C to stop)..."
	cd platform-api && npx tsx watch src/server.ts &
	cd platform-api && npx tsx watch src/worker.ts &
	cd dashboard && npx vite --port 5173 &
	wait

# ── Testing ──────────────────────────────────────────────────

test: test-api test-dashboard

test-api:
	cd platform-api && npm test

test-dashboard:
	cd dashboard && npm test

test-go:
	cd go && go test ./...

# ── Linting ──────────────────────────────────────────────────

lint: lint-api lint-dashboard

lint-api:
	cd platform-api && npm run lint

lint-dashboard:
	cd dashboard && npm run lint

lint-go:
	cd go && go vet ./...

# ── Build ────────────────────────────────────────────────────

build: build-api build-dashboard

build-api:
	cd platform-api && npm run build

build-dashboard:
	cd dashboard && npm run build

build-go:
	cd go && CGO_ENABLED=0 go build -ldflags="$(GO_LDFLAGS)" -o bin/sc-scan ./cmd/sc-scan
	cd go && CGO_ENABLED=0 go build -ldflags="$(GO_LDFLAGS)" -o bin/sc-agent ./cmd/sc-agent
	cd go && CGO_ENABLED=0 go build -ldflags="$(GO_LDFLAGS)" -o bin/sc-certmon ./cmd/sc-certmon

build-agent:
	@echo "Building sc-agent v$(AGENT_VERSION) for linux/amd64 + linux/arm64..."
	cd go && GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="$(GO_LDFLAGS)" -o bin/sc-agent-linux-amd64 ./cmd/sc-agent
	cd go && GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags="$(GO_LDFLAGS)" -o bin/sc-agent-linux-arm64 ./cmd/sc-agent
	@echo "Built: go/bin/sc-agent-linux-amd64, go/bin/sc-agent-linux-arm64 (v$(AGENT_VERSION))"

# ── Docker ───────────────────────────────────────────────────

docker-up:
	@docker compose up -d
	@echo "Waiting for services to be healthy..."
	@sleep 2
	@docker compose ps

docker-down:
	docker compose down

docker-clean:
	docker compose down -v

# ── Database ─────────────────────────────────────────────────

migrate:
	cd platform-api && npx prisma migrate dev

seed:
	cd platform-api && npx prisma db seed

# ── Cleanup ──────────────────────────────────────────────────

clean: stop
	rm -rf platform-api/dist dashboard/dist go/bin
	rm -rf $(PID_DIR) logs

# ── Internal ─────────────────────────────────────────────────

_ensure_pid_dir:
	@mkdir -p $(PID_DIR) $(LOG_DIR)
