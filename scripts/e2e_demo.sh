#!/usr/bin/env sh
set -eu

# End-to-end demo:
# 1) start Postgres/Redis
# 2) run migrations
# 3) seed demo app/policy/entities
# 4) run backend
# 5) call /v1/authorize

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

echo "[1/5] starting db+redis"
docker compose -f "$ROOT_DIR/docker-compose.yml" up -d db redis

echo "[2/5] running migrations"
(cd "$ROOT_DIR" && make backend-migrate)

echo "[3/5] seeding demo data"
(cd "$ROOT_DIR" && make backend-seed) | tee /tmp/cedar_seed.log >/dev/null || true

APP_ID="$(grep -Eo 'APP_ID=[0-9]+' /tmp/cedar_seed.log | tail -n 1 | cut -d= -f2)"
if [ -z "$APP_ID" ]; then
  echo "could not determine APP_ID from seed output" >&2
  exit 1
fi

echo "[4/5] starting backend"
# run in background so we can curl it
(cd "$ROOT_DIR" && make backend-run) &
BACKEND_PID=$!

cleanup() {
  kill "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup EXIT

# Wait for health
ATTEMPTS=40
until curl -fsS "http://localhost:8080/health" >/dev/null 2>&1; do
  ATTEMPTS=$((ATTEMPTS-1))
  if [ "$ATTEMPTS" -le 0 ]; then
    echo "backend did not become ready" >&2
    exit 1
  fi
  sleep 0.25
done

echo "[5/5] calling authorize"
curl -fsS "http://localhost:8080/v1/authorize" \
  -H 'Content-Type: application/json' \
  -d '{
    "application_id": '"$APP_ID"',
    "principal": {"type":"User","id":"alice"},
    "action": {"type":"Action","id":"view"},
    "resource": {"type":"Document","id":"demo-doc"},
    "context": {}
  }' | cat

echo "\nDone. (If application_id != 1, create an app via POST /v1/apps and re-run seed.)"
