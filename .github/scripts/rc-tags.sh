#!/usr/bin/env bash
# Version math on the v* tags of the checkout. Prints "<tag> <last final tag or empty>".
#   rc-tags.sh next patch|minor|major   next RC tag: rc.N+1 of the target if its RC line is unpromoted, else rc.1
#   rc-tags.sh promote [vX.Y.Z-rc.N]    the RC to promote (default: the newest); refuses a stale RC or an existing final
set -euo pipefail
tags=$(git tag -l 'v*')
last=$(grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' <<<"$tags" | sort -V | tail -n1 || true)
rcs() { grep -E "^v${1:-[0-9]+\.[0-9]+\.[0-9]+}-rc\.[0-9]+$" <<<"$tags" | sort -V || true; }
case "${1:?next|promote}" in
  next)
    IFS=. read -r major minor patch <<<"${last#v}"
    : "${major:=0}" "${minor:=0}" "${patch:=0}"
    case "${2:?patch|minor|major}" in
      patch) patch=$((patch + 1));;
      minor) minor=$((minor + 1)); patch=0;;
      major) major=$((major + 1)); minor=0; patch=0;;
      *) echo "::error::bump must be patch, minor or major" >&2; exit 1;;
    esac
    target="$major.$minor.$patch"
    n=$(rcs "${target//./\\.}" | tail -n1 | sed -E 's/.*-rc\.//')
    echo "v$target-rc.$((${n:-0} + 1)) $last";;
  promote)
    rc=${2:-$(rcs | tail -n1)}
    [[ "$rc" =~ ^v([0-9]+\.[0-9]+\.[0-9]+)-rc\.[0-9]+$ ]] || { echo "::error::'$rc' is not an RC tag (vX.Y.Z-rc.N)" >&2; exit 1; }
    final="v${BASH_REMATCH[1]}"
    git rev-parse -q --verify "refs/tags/$rc" > /dev/null || { echo "::error::tag $rc does not exist" >&2; exit 1; }
    [ "$(rcs "${BASH_REMATCH[1]//./\\.}" | tail -n1)" = "$rc" ] || { echo "::error::$rc is not the newest RC of ${final#v}" >&2; exit 1; }
    ! grep -qx "$final" <<<"$tags" || { echo "::error::$final already exists" >&2; exit 1; }
    echo "$rc $final";;
  *) echo "usage: rc-tags.sh next <bump> | promote [rc]" >&2; exit 1;;
esac
