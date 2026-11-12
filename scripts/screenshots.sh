#!/usr/bin/env bash
# Regenerates the README and landing-page screenshots in docs/assets/ on seeded demo data (see CONTRIBUTING.md).
set -euo pipefail
cd "$(dirname "$0")/.."

free_port() { node -e 'const s=require("net").createServer().listen(0,()=>{console.log(s.address().port);s.close()})'; }

tmp=$(mktemp -d)
pg=bauherr-shots-pg
server_pid=
cleanup() {
  [ -z "$server_pid" ] || kill "$server_pid" 2>/dev/null || true
  docker rm -f "$pg" > /dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

(umask 077; head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$tmp/password")
mkdir "$tmp/media"
pg_port=$(free_port)
docker rm -f "$pg" > /dev/null 2>&1 || true
docker run -d --name "$pg" -e POSTGRES_USER=bauherr -e POSTGRES_PASSWORD=bauherr -e POSTGRES_DB=bauherr -p "$pg_port:5432" postgres:17 > /dev/null
until docker exec "$pg" pg_isready -U bauherr -d bauherr > /dev/null 2>&1; do sleep 1; done

export E2E_EMAIL=e2e@example.com E2E_PASSWORD_FILE="$tmp/password" LOGIN_IP_MAX_ATTEMPTS=1000 OTEL_ENABLED=0 MEDIA_DIR="$tmp/media"
export DATABASE_URL="postgres://bauherr:bauherr@localhost:$pg_port/bauherr"
export BAUHERR_E2E_FAKE_FORGE=1 INTAKE_FAKE=1 CHAT_FAKE=1 E2E_FAKE_FORGE=1 E2E_GATED_PACK=1
export BAUHERR_PACK_DIR="$PWD/apps/server/tests/fixtures/gated-pack"
PAYLOAD_SECRET=$(openssl rand -hex 24); ENCRYPTION_KEY=$(openssl rand -hex 32)
export PAYLOAD_SECRET ENCRYPTION_KEY

pnpm install --frozen-lockfile
pnpm build:packages
pnpm --filter server gen:migrations
BAUHERR_TEST_BUILD=1 pnpm --filter server build

port=$(free_port)
(cd apps/server && exec node_modules/.bin/next start -p "$port") > "$tmp/app.log" 2>&1 &
server_pid=$!
curl --fail --silent --retry 60 --retry-delay 2 --retry-connrefused -o /dev/null "http://localhost:$port/login"
pnpm --filter server seed:e2e

docker run --rm --ipc=host --user "$(id -u):$(id -g)" --add-host=host.docker.internal:host-gateway \
  -v "$PWD:/work" -v "$tmp/password:/pw:ro" -w /work/apps/server \
  -e HOME=/tmp -e BASE_URL="http://host.docker.internal:$port" -e E2E_EMAIL -e E2E_PASSWORD_FILE=/pw \
  -e DATABASE_URL="postgres://bauherr:bauherr@host.docker.internal:$pg_port/bauherr" -e SCREENSHOTS=1 \
  -e E2E_FAKE_FORGE -e INTAKE_FAKE -e CHAT_FAKE -e E2E_GATED_PACK \
  mcr.microsoft.com/playwright:v1.64.1-noble npx playwright test e2e/screenshots.spec.ts
