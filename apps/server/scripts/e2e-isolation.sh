#!/usr/bin/env bash
# Check that no e2e spec depends on another: (1) every spec file alone on a freshly migrated and seeded DB, (2) all files in reverse alphabetical order, one after the other on one DB.
# Each file passing alone covers any shard split. Prints a summary table; exits 1 if any run failed.
# Usage (repo root, the env of the e2e-fake job, test build already made with BAUHERR_TEST_BUILD=1): apps/server/scripts/e2e-isolation.sh [e2e/a.spec.ts ...]   (default: every spec)
# Optional env: PORT (3000), E2E_DB_RESET (default: psql "$DATABASE_URL" drops and recreates the public schema), E2E_DOCKER_NET (default: --network host), E2E_BASE_URL (default http://localhost:$PORT).
set -uo pipefail

port=${PORT:-3000}
base=${E2E_BASE_URL:-http://localhost:$port}
net=${E2E_DOCKER_NET:---network host}
cd "$(dirname "$0")/../../.."
specs=("$@")
if [ ${#specs[@]} -eq 0 ]; then
  while IFS= read -r f; do specs+=("e2e/${f##*/}"); done < <(ls apps/server/e2e/*.spec.ts | sort)
fi

fresh() { # stop the server, reset the DB, boot (it migrates on boot), seed
  fuser -k "$port/tcp" > /dev/null 2>&1 || true
  while fuser "$port/tcp" > /dev/null 2>&1; do sleep 1; done
  if [ -n "${E2E_DB_RESET:-}" ]; then eval "$E2E_DB_RESET"; else psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'; fi
  setsid nohup pnpm --filter server start >> apps/server/e2e/app.log 2>&1 < /dev/null &
  curl --fail --silent --retry 60 --retry-delay 2 --retry-connrefused -o /dev/null "$base/login" || { echo "server did not start"; return 1; }
  pnpm --filter server seed:e2e
}

play() { # run one spec file in Playwright
  docker run --rm $net --ipc=host --user "$(id -u):$(id -g)" \
    -v "$PWD:/work" -v "$E2E_PASSWORD_FILE:/pw:ro" -w /work/apps/server \
    -e BASE_URL="$base" -e E2E_EMAIL -e E2E_PASSWORD_FILE=/pw -e E2E_FAKE_FORGE -e INTAKE_FAKE -e E2E_GATED_PACK -e HOME=/tmp \
    mcr.microsoft.com/playwright:v1.64.1-noble npx playwright test "$1" --reporter=line
}

results=()
failed=0
for spec in "${specs[@]}"; do
  echo "::group::alone: $spec"
  if fresh && play "$spec"; then r=pass; else r=FAIL; failed=1; fi
  echo "::endgroup::"
  results+=("alone    $r  $spec")
done

echo "::group::reverse order on one DB"
fresh || failed=1
for ((i = ${#specs[@]} - 1; i >= 0; i--)); do
  if play "${specs[i]}"; then r=pass; else r=FAIL; failed=1; fi
  results+=("reverse  $r  ${specs[i]}")
done
echo "::endgroup::"
fuser -k "$port/tcp" > /dev/null 2>&1 || true

printf '\nisolation summary\n'
printf '%s\n' "${results[@]}"
exit $failed
