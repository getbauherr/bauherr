#!/usr/bin/env bash
# Reports check `production` on $SHA (the Ticket's merge sha, not the workflow's HEAD). Needs GH_TOKEN, GITHUB_REPOSITORY, SHA, STATUS, RUN_URL.
set -euo pipefail
[ -n "${SHA:-}" ] || { echo "::warning::no sha resolved, nothing to report"; exit 0; }
[ "$STATUS" = success ] && conclusion=success || conclusion=failure
gh api "repos/$GITHUB_REPOSITORY/check-runs" -f name=production -f "head_sha=$SHA" -f status=completed -f "conclusion=$conclusion" \
  -f "details_url=$RUN_URL" -f "output[title]=production $conclusion" -f "output[summary]=$RUN_URL"
