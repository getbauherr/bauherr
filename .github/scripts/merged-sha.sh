#!/usr/bin/env bash
# Prints the merge sha of the newest merged factory PR (head branch bauherr/<issue>-*) of issue $1, from the closed PRs JSON array on stdin.
set -euo pipefail
n=$(jq -r --arg p "bauherr/$1-" '[.[] | select(.merged_at != null and (.head.ref | startswith($p)))]
  | sort_by(.merged_at) | last | .merge_commit_sha // empty')
[ -n "$n" ] || { echo "::error::no merged factory PR for issue $1" >&2; exit 1; }
echo "$n"
