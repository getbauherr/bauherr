#!/usr/bin/env bash
# Burn in the given e2e specs: 3 passes, each on a freshly migrated and seeded DB with a restarted server (the BAUHERR_TEST_BUILD=1 build of the e2e-fake job).
# Usage (repo root, CI env of the e2e-fake job): apps/server/scripts/e2e-burnin.sh e2e/a.spec.ts [e2e/b.spec.ts ...]
set -euo pipefail

for pass in 1 2 3; do
  echo "::group::burn-in pass $pass/3"
  # the parent `next start` forks `next-server`, which keeps the port and its in-memory fake forge (answers of earlier specs) when only the parent is killed: stop both so every pass starts a clean server
  pkill -f 'next start' || true
  pkill -f 'next-server' || true
  while pgrep -f 'next start|next-server' > /dev/null; do sleep 1; done
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
  # the server migrates on boot, so seed after it is up
  pnpm --filter server start >> apps/server/e2e/app.log 2>&1 &
  curl --fail --silent --retry 60 --retry-delay 2 --retry-connrefused -o /dev/null http://localhost:3000/login
  pnpm --filter server seed:e2e
  echo "::endgroup::"
  docker run --rm --network host --ipc=host --user "$(id -u):$(id -g)" \
    -v "$PWD:/work" -v "$E2E_PASSWORD_FILE:/pw:ro" -w /work/apps/server \
    -e BASE_URL=http://localhost:3000 -e E2E_EMAIL -e E2E_PASSWORD_FILE=/pw -e E2E_FAKE_FORGE -e INTAKE_FAKE -e E2E_GATED_PACK -e HOME=/tmp \
    mcr.microsoft.com/playwright:v1.64.1-noble npx playwright test "$@" --reporter=line
done
