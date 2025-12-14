SHELL := /bin/sh

.PHONY: backend-run backend-lint backend-migrate backend-seed web-install web-dev web-build compose-up compose-down e2e-demo

backend-run:
	cd backend && go run ./cmd/server

backend-migrate:
	cd backend && go run ./cmd/migrate

backend-seed:
	cd backend && go run ./cmd/seed

backend-lint:
	cd backend && golangci-lint run ./...

web-install:
	cd web && npm install

web-dev:
	cd web && npm run dev

web-build:
	cd web && npm run build

compose-up:
	docker compose up -d --build db redis
	docker compose run --rm migrate
	docker compose run --rm seed
	docker compose up -d --build backend web

compose-down:
	docker compose down

e2e-demo:
	sh ./scripts/e2e_demo.sh
