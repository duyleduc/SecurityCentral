.PHONY: start stop restart dev dev-stop dev-restart test build migrate seed

# Infrastructure
start:
	docker compose up -d
	@echo "Waiting for MySQL to be healthy..."
	@until docker compose exec mysql mysqladmin ping -h localhost -u root -prootpassword --silent 2>/dev/null; do sleep 1; done
	@echo "MySQL is ready."

stop:
	-@lsof -ti:3000 | xargs kill 2>/dev/null || true
	-@lsof -ti:5173 | xargs kill 2>/dev/null || true
	docker compose down

restart: stop start

# Development (starts infra + API + dashboard)
dev: start
	cd platform-api && npm run dev &
	cd dashboard && npm run dev &
	@echo "API: http://localhost:3000  Dashboard: http://localhost:5173"

dev-stop:
	-@lsof -ti:3000 | xargs kill 2>/dev/null || true
	-@lsof -ti:5173 | xargs kill 2>/dev/null || true
	@echo "Dev servers stopped."

dev-restart: dev-stop dev

# Database
migrate:
	cd platform-api && npx prisma migrate dev

seed:
	cd platform-api && npx prisma db seed

# Testing
test:
	cd platform-api && npm test
	cd dashboard && npm test

# Build
build:
	cd platform-api && npm run build
	cd dashboard && npm run build
