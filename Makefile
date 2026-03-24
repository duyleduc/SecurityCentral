.PHONY: dev test lint build docker-up docker-down migrate clean

# ── Development ──────────────────────────────────────────────

dev: docker-up
	@echo "Starting platform-api and dashboard in dev mode..."
	cd platform-api && npm run dev &
	cd dashboard && npm run dev &
	wait

# ── Testing ──────────────────────────────────────────────────

test: test-api test-dashboard test-go

test-api:
	cd platform-api && npm test

test-dashboard:
	cd dashboard && npm test

test-go:
	cd go && go test ./...

# ── Linting ──────────────────────────────────────────────────

lint: lint-api lint-dashboard lint-go

lint-api:
	cd platform-api && npm run lint

lint-dashboard:
	cd dashboard && npm run lint

lint-go:
	cd go && go vet ./...

# ── Build ────────────────────────────────────────────────────

build: build-api build-dashboard build-go

build-api:
	cd platform-api && npm run build

build-dashboard:
	cd dashboard && npm run build

build-go:
	cd go && CGO_ENABLED=0 go build -ldflags="-s -w" -o bin/sc-scan ./cmd/sc-scan
	cd go && CGO_ENABLED=0 go build -ldflags="-s -w" -o bin/sc-agent ./cmd/sc-agent
	cd go && CGO_ENABLED=0 go build -ldflags="-s -w" -o bin/sc-certmon ./cmd/sc-certmon

# ── Docker ───────────────────────────────────────────────────

docker-up:
	docker compose up -d
	@echo "Waiting for services to be healthy..."
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

clean:
	rm -rf platform-api/dist dashboard/dist go/bin
	rm -rf node_modules platform-api/node_modules dashboard/node_modules
