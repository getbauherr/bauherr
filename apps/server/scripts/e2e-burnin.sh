#!/usr/bin/env bash
# Burn in the given e2e specs: 3 passes, each on a freshly migrated and seeded DB with a restarted dev server.
# Usage (repo root, CI env of the e2e-fake job): apps/server/scripts/e2e-burnin.sh e2e/a.spec.ts [e2e/b.spec.ts ...]
set -euo pipefail

for pass in 1 2 3; do
  echo "::group::burn-in pass $pass/3"
  pkill -f 'next dev' || true
  while pgrep -f 'next dev' > /dev/null; do sleep 1; done
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
  pnpm --filter server gen:migrations
  pnpm --filter server seed:e2e
  pnpm --filter server dev >> apps/server/e2e/app.log 2>&1 &
  curl --fail --silent --retry 60 --retry-delay 2 --retry-connrefused -o /dev/null http://localhost:3000/login
  for path in / /intake /tickets/1; do curl --silent -o /dev/null "http://localhost:3000$path"; done
  echo "::endgroup::"
  docker run --rm --network host --ipc=host --user "$(id -u):$(id -g)" \
    -v "$PWD:/work" -v "$E2E_PASSWORD_FILE:/pw:ro" -w /work/apps/server \
    -e BASE_URL=http://localhost:3000 -e E2E_EMAIL -e E2E_PASSWORD_FILE=/pw -e E2E_FAKE_FORGE -e INTAKE_FAKE -e E2E_GATED_PACK -e HOME=/tmp \
    mcr.microsoft.com/playwright:v1.64.1-noble npx playwright test "$@" --reporter=line
done
