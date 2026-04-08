.PHONY: start stop dev test build migrate seed

# Infrastructure
start:
	docker compose up -d

stop:
	docker compose down

# Development
dev: start
	cd platform-api && npm run dev &
	cd dashboard && npm run dev &

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
