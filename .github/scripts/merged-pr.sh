#!/usr/bin/env bash
# Prints the number of the newest merged PR of $1 (owner/repo) that references the issue, from timeline JSON on stdin.
set -euo pipefail
n=$(jq -r --arg repo "$1" '[.[] | select(.event == "cross-referenced") | .source.issue
  | select(.pull_request.merged_at != null and (.repository_url | endswith("/repos/" + $repo)))]
  | sort_by(.pull_request.merged_at) | last | .number // empty')
[ -n "$n" ] || { echo "::error::no merged PR references this issue" >&2; exit 1; }
echo "$n"
