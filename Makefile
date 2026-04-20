.PHONY: start stop restart dev dev-stop dev-restart test build migrate seed ensure-db

# Infrastructure
start:
	docker compose up -d
	@echo "Waiting for Postgres to be healthy..."
	@until docker compose exec postgres pg_isready -U securitycentral -d securitycentral 2>/dev/null; do sleep 1; done
	@echo "Postgres is ready."

stop:
	-@lsof -ti:3000 | xargs kill -9 2>/dev/null || true
	-@lsof -ti:5173 | xargs kill -9 2>/dev/null || true
	docker compose down

restart: stop start

# Ensure Postgres is running (no-op if already up)
ensure-db:
	@docker compose exec postgres pg_isready -U securitycentral -d securitycentral 2>/dev/null || $(MAKE) start

# Development (starts infra + API + dashboard + monitor)
dev: ensure-db build-monitor
	cd platform-api && npm run dev &
	cd dashboard && npm run dev &
	cd sc-monitor && ./bin/sc-monitor &
	@echo "API: http://localhost:3000  Dashboard: http://localhost:5173  Monitor: running"

dev-stop:
	@echo "Stopping dev servers..."
	-@pkill -9 -f "platform-api.*tsx" 2>/dev/null; true
	-@pkill -9 -f "dashboard.*vite" 2>/dev/null; true
	-@pkill -9 -f "bin/sc-monitor" 2>/dev/null; true
	-@lsof -ti:3000 2>/dev/null | xargs kill -9 2>/dev/null; true
	-@lsof -ti:5173 2>/dev/null | xargs kill -9 2>/dev/null; true
	@sleep 1
	@echo "Dev servers stopped."

dev-restart:
	-@pkill -9 -f "platform-api.*tsx" 2>/dev/null; true
	-@pkill -9 -f "dashboard.*vite" 2>/dev/null; true
	-@pkill -9 -f "bin/sc-monitor" 2>/dev/null; true
	-@lsof -ti:3000 2>/dev/null | xargs kill -9 2>/dev/null; true
	-@lsof -ti:5173 2>/dev/null | xargs kill -9 2>/dev/null; true
	@sleep 1
	@cd sc-monitor && go build -o bin/sc-monitor ./cmd/sc-monitor
	@docker compose exec postgres pg_isready -U securitycentral -d securitycentral 2>/dev/null || $(MAKE) start
	cd platform-api && npm run dev &
	cd dashboard && npm run dev &
	cd sc-monitor && ./bin/sc-monitor &
	@echo "API: http://localhost:3000  Dashboard: http://localhost:5173  Monitor: running"

# Database
migrate:
	cd platform-api && npx prisma migrate dev

seed:
	cd platform-api && npx prisma db seed

# Testing
test:
	cd platform-api && npm test
	cd dashboard && npm test
	cd sc-agent && go test -race ./...
	cd sc-scan && go test -race ./...

# Build
build: build-api build-dashboard build-scanner build-agent build-monitor

build-api:
	cd platform-api && npm run build

build-dashboard:
	cd dashboard && npm run build

build-scanner:
	cd sc-scan && go build -o bin/sc-scan ./cmd/sc-scan

build-agent:
	cd sc-agent && go build -o bin/sc-agent ./cmd/sc-agent
	cd sc-agent && GOOS=linux GOARCH=amd64 go build -o bin/sc-agent-linux-amd64 ./cmd/sc-agent
	cd sc-agent && GOOS=linux GOARCH=arm64 go build -o bin/sc-agent-linux-arm64 ./cmd/sc-agent

build-monitor:
	cd sc-monitor && go build -o bin/sc-monitor ./cmd/sc-monitor

build-scanner-all:
	cd sc-scan && GOOS=linux GOARCH=amd64 go build -o bin/sc-scan-linux-amd64 ./cmd/sc-scan
	cd sc-scan && GOOS=linux GOARCH=arm64 go build -o bin/sc-scan-linux-arm64 ./cmd/sc-scan
	cd sc-scan && GOOS=darwin GOARCH=amd64 go build -o bin/sc-scan-darwin-amd64 ./cmd/sc-scan
	cd sc-scan && GOOS=darwin GOARCH=arm64 go build -o bin/sc-scan-darwin-arm64 ./cmd/sc-scan

build-agent-all:
	cd sc-agent && GOOS=linux GOARCH=amd64 go build -o bin/sc-agent-linux-amd64 ./cmd/sc-agent
	cd sc-agent && GOOS=linux GOARCH=arm64 go build -o bin/sc-agent-linux-arm64 ./cmd/sc-agent
