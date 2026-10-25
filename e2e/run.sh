#!/bin/bash
# End-to-end tests: the real web app in Chromium against a local backend, with a throwaway database (in the dev
# container, docs/07), moto standing in for R2 and a fake AI that replays scripted answers. Leaves nothing behind.
#
#   e2e/run.sh                  # every journey
#   e2e/run.sh -k notes         # pytest options pass through
set -euo pipefail
cd "$(dirname "$0")"
E2E=$(pwd); ROOT=$(dirname "$E2E"); BACKEND=$ROOT/backend; FRONTEND=$ROOT/frontend
API=8041; S3=8042; AI=8043; WEB=8044
DB=e2e_$$
WORK=$(mktemp -d)
PIDS=()

cleanup() {
  for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done
  podman exec pico-reader-db dropdb -U reader --if-exists "$DB" >/dev/null 2>&1 || true
  [ -n "${KEEP_LOGS:-}" ] && echo "Logs kept in $WORK" || rm -rf "$WORK"
}
trap cleanup EXIT

wait_for() {  # url, name
  for _ in $(seq 1 60); do curl -s -o /dev/null "$1" && return 0; sleep 0.5; done
  echo "❌ $2 didn't start (logs: KEEP_LOGS=1 e2e/run.sh)"; exit 1
}

for port in $API $S3 $AI $WEB; do
  if curl -s -o /dev/null "http://localhost:$port"; then echo "❌ Port $port is in use"; exit 1; fi
done
[ -x .venv/bin/python ] || { python3.12 -m venv .venv && .venv/bin/pip install -q -r requirements.txt; }

echo "▶ database $DB"
podman exec pico-reader-db createdb -U reader "$DB"
podman exec pico-reader-db psql -U reader -d "$DB" -qc "CREATE EXTENSION IF NOT EXISTS vector"
export DATABASE_URL=postgresql+psycopg://reader:reader@127.0.0.1:5440/$DB SECRET_KEY=e2e-secret ENVIRONMENT=development \
  CORS_ORIGINS=http://localhost:$WEB R2_ENDPOINT=http://localhost:$S3 R2_ACCOUNT_ID=e2e R2_ACCESS_KEY_ID=e2e \
  R2_SECRET_ACCESS_KEY=e2e R2_BUCKET=e2e-library GROQ_API_KEY=e2e GROQ_BASE_URL=http://localhost:$AI
unset CLOUDFLARE_EMAIL_API_TOKEN BREVO_API_KEY  # sign-in codes go to the API log
(cd "$BACKEND" && .venv/bin/alembic upgrade head >/dev/null 2>&1)

echo "▶ servers"
"$BACKEND/.venv/bin/moto_server" -p $S3 >"$WORK/s3.log" 2>&1 & PIDS+=($!)
.venv/bin/python fake_ai.py $AI >"$WORK/ai.log" 2>&1 & PIDS+=($!)
(cd "$BACKEND" && exec .venv/bin/uvicorn app.main:app --port $API) >"$WORK/api.log" 2>&1 & PIDS+=($!)
wait_for "http://localhost:$S3" "moto"; wait_for "http://localhost:$AI/health" "the fake AI"; wait_for "http://localhost:$API/health" "the API"

echo "▶ web app build"
(cd "$FRONTEND" && VITE_API_URL=http://localhost:$API NODE_OPTIONS=--max-old-space-size=2048 \
  npx vite build --outDir "$WORK/web" --emptyOutDir >"$WORK/build.log" 2>&1) || { tail -20 "$WORK/build.log"; exit 1; }
(cd "$FRONTEND" && exec npx vite preview --port $WEB --strictPort --outDir "$WORK/web") >"$WORK/web.log" 2>&1 & PIDS+=($!)
wait_for "http://localhost:$WEB" "the web app"

echo "▶ seed"
(cd "$BACKEND" && PYTHONPATH="$BACKEND" .venv/bin/python "$E2E/seed.py" "http://localhost:$API" "http://localhost:$S3")

echo "▶ tests"
E2E_WEB=http://localhost:$WEB E2E_API=http://localhost:$API E2E_AI=http://localhost:$AI E2E_API_LOG=$WORK/api.log \
  .venv/bin/python -m pytest -q tests -p no:cacheprovider "$@"
