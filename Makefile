.PHONY: start stop restart dev dev-stop dev-restart test build migrate seed ensure-mysql

# Infrastructure
start:
	docker compose up -d
	@echo "Waiting for MySQL to be healthy..."
	@until docker compose exec mysql mysqladmin ping -h localhost -u root -prootpassword --silent 2>/dev/null; do sleep 1; done
	@echo "MySQL is ready."

stop:
	-@lsof -ti:3000 | xargs kill -9 2>/dev/null || true
	-@lsof -ti:5173 | xargs kill -9 2>/dev/null || true
	docker compose down

restart: stop start

# Ensure MySQL is running (no-op if already up)
ensure-mysql:
	@docker compose exec mysql mysqladmin ping -h localhost -u root -prootpassword --silent 2>/dev/null || $(MAKE) start

# Development (starts infra + API + dashboard)
dev: ensure-mysql
	cd platform-api && npm run dev &
	cd dashboard && npm run dev &
	@echo "API: http://localhost:3000  Dashboard: http://localhost:5173"

dev-stop:
	-@lsof -ti:3000 | xargs kill -9 2>/dev/null || true
	-@lsof -ti:5173 | xargs kill -9 2>/dev/null || true
	@sleep 1
	@echo "Dev servers stopped."

dev-restart:
	-@lsof -ti:3000 | xargs kill -9 2>/dev/null || true
	-@lsof -ti:5173 | xargs kill -9 2>/dev/null || true
	@sleep 1
	@docker compose exec mysql mysqladmin ping -h localhost -u root -prootpassword --silent 2>/dev/null || $(MAKE) start
	cd platform-api && npm run dev &
	cd dashboard && npm run dev &
	@echo "API: http://localhost:3000  Dashboard: http://localhost:5173"

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
build: build-api build-dashboard build-scanner build-agent

build-api:
	cd platform-api && npm run build

build-dashboard:
	cd dashboard && npm run build

build-scanner:
	cd sc-scan && go build -o bin/sc-scan ./cmd/sc-scan

build-agent:
	cd sc-agent && go build -o bin/sc-agent ./cmd/sc-agent

build-scanner-all:
	cd sc-scan && GOOS=linux GOARCH=amd64 go build -o bin/sc-scan-linux-amd64 ./cmd/sc-scan
	cd sc-scan && GOOS=linux GOARCH=arm64 go build -o bin/sc-scan-linux-arm64 ./cmd/sc-scan
	cd sc-scan && GOOS=darwin GOARCH=amd64 go build -o bin/sc-scan-darwin-amd64 ./cmd/sc-scan
	cd sc-scan && GOOS=darwin GOARCH=arm64 go build -o bin/sc-scan-darwin-arm64 ./cmd/sc-scan

build-agent-all:
	cd sc-agent && GOOS=linux GOARCH=amd64 go build -o bin/sc-agent-linux-amd64 ./cmd/sc-agent
	cd sc-agent && GOOS=linux GOARCH=arm64 go build -o bin/sc-agent-linux-arm64 ./cmd/sc-agent
