#!/usr/bin/env bash
# Prints true when <sha> is the current tip of the default branch of $GITHUB_REPOSITORY, else false. Needs GH_TOKEN.
# Usage: is-tip.sh <sha>
set -euo pipefail
sha=${1:?sha}
branch=$(gh api "repos/$GITHUB_REPOSITORY" --jq .default_branch)
tip=$(gh api "repos/$GITHUB_REPOSITORY/commits/$branch" --jq .sha)
[ "$tip" = "$sha" ] && echo true || echo false
