#!/usr/bin/env bash
# Polls <url>/api/health until its JSON field <field> equals <expected> and ok is true, for <minutes> (default 15).
# Usage: wait-health.sh <url> <field> <expected> [minutes]
set -euo pipefail
url=${1:?url}; field=${2:?field}; expected=${3:?expected}; minutes=${4:-15}
deadline=$((SECONDS + minutes * 60))
while :; do
  if body=$(curl -fsS --max-time 10 "$url/api/health" 2>/dev/null) && jq -e --arg f "$field" --arg v "$expected" '.ok == true and .[$f] == $v' <<<"$body" > /dev/null; then
    echo "$url reports $field=$expected"
    exit 0
  fi
  [ "$SECONDS" -lt "$deadline" ] || { echo "::error::$url did not report $field=$expected within $minutes minutes (last: ${body:-no answer})"; exit 1; }
  sleep 10
done
