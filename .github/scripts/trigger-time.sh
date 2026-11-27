#!/usr/bin/env bash
# Prints the time to hand wait-health.sh as <after> (take it before triggering a deploy): now, or nothing when <url> already reports <field>=<expected>, because a redeploy of the same version may not restart the app.
# Usage: trigger-time.sh <url> <field> <expected>
set -euo pipefail
url=${1:?url}; field=${2:?field}; expected=${3:?expected}
if curl -fsS --max-time 10 "$url/api/health" 2>/dev/null | jq -e --arg f "$field" --arg v "$expected" '.ok == true and .[$f] == $v' > /dev/null; then
  echo "::notice::$url already reports $field=$expected: a restart is not required for the deploy to count" >&2
  exit 0
fi
date -u +%Y-%m-%dT%H:%M:%S.%3NZ
