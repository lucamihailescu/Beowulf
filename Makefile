SHELL := /bin/sh

.PHONY: backend-run backend-lint backend-migrate backend-seed backend-docs backend-perf backend-perf-gate web-install web-dev web-build compose-up compose-down e2e-demo clients-grpc clients-rest clients-all clients-python clients-javascript clients-csharp

backend-run:
	cd backend && go run ./cmd/server

backend-migrate:
	cd backend && go run ./cmd/migrate

backend-seed:
	cd backend && go run ./cmd/seed

backend-lint:
	cd backend && golangci-lint run ./...

backend-docs:
	cd backend && go run github.com/swaggo/swag/cmd/swag@latest init -g internal/httpserver/router.go --output docs

backend-perf:
	cd backend && go test ./internal/grpc -run '^$$' -bench 'BenchmarkServer(Check|BatchCheck_100)$$' -benchmem -count=1
	cd backend && go test ./internal/storage -run '^$$' -bench 'BenchmarkCached(PolicyProvider|EntityProvider)(Warm|Cold)$$' -benchmem -count=1

backend-perf-gate:
	cd backend && sh ./scripts/perf_gate.sh

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
	docker compose up -d --build backend web load-balancer

compose-down:
	docker compose down

e2e-demo:
	sh ./scripts/e2e_demo.sh

# =============================================================================
# Client SDK Generation
# =============================================================================

clients-grpc:
	chmod +x clients/generate.sh
	./clients/generate.sh --grpc --all-languages

clients-rest:
	chmod +x clients/generate.sh
	./clients/generate.sh --rest --all-languages

clients-all:
	chmod +x clients/generate.sh
	./clients/generate.sh --all --all-languages

clients-python:
	chmod +x clients/generate.sh
	./clients/generate.sh --all --python

clients-javascript:
	chmod +x clients/generate.sh
	./clients/generate.sh --all --javascript

clients-csharp:
	chmod +x clients/generate.sh
	./clients/generate.sh --all --csharp
