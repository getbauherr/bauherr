#!/usr/bin/env bash
# Lists the Playwright tests that passed only on a retry (status "flaky") of one shard's JSON report: a table in $GITHUB_STEP_SUMMARY,
# and, when GH_TOKEN, GITHUB_REPOSITORY and SHA are set, a non-required check run `e2e-flaky (shard N)` whose output.text is the JSON [{shard,file,title}] the factory records in check_flakes.
# Usage: e2e-flakes.sh <shard> <report.json>. Never fails the job.
set -uo pipefail
shard=${1:?shard}; report=${2:?report}
[ -s "$report" ] || { echo "::warning::no Playwright report at $report"; exit 0; }
flakes=$(jq -c --arg shard "$shard" 'def titled($chain): . as $s | (if ($s.file // "") != "" then $chain + [$s.title] else $chain end) as $c | (($s.specs // [])[] | select(any(.tests[]; .status == "flaky")) | {shard: $shard, file, title: (($c[1:]) + [.title] | join(" › "))}), (($s.suites // [])[] | titled($c)); [.suites[] | titled([])]' "$report") || { echo "::warning::unreadable report $report"; exit 0; }
n=$(jq length <<<"$flakes")
{
  echo "### e2e flaky tests (shard $shard): $n"
  if [ "$n" -gt 0 ]; then
    echo "| shard | spec file | title |"; echo "|---|---|---|"
    jq -r '.[] | "| \(.shard) | \(.file) | \(.title | gsub("\\|"; "\\|")) |"' <<<"$flakes"
  fi
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
echo "e2e flaky tests (shard $shard): $n"
if [ -n "${GH_TOKEN:-}" ] && [ -n "${GITHUB_REPOSITORY:-}" ] && [ -n "${SHA:-}" ]; then
  [ "$n" -gt 0 ] && conclusion=neutral || conclusion=success
  gh api "repos/$GITHUB_REPOSITORY/check-runs" -f "name=e2e-flaky (shard $shard)" -f "head_sha=$SHA" -f status=completed -f "conclusion=$conclusion" \
    -f "details_url=${RUN_URL:-}" -f "output[title]=$n flaky e2e test(s)" -f "output[summary]=${RUN_URL:-}" -f "output[text]=$flakes" > /dev/null \
    || echo "::warning::could not publish the e2e-flaky check run"
fi
exit 0
