#!/usr/bin/env bash
# Starts the operator's deploy pipeline that deploys Bauherr (a GitLab pipeline trigger or any compatible endpoint). Needs DEPLOY_TRIGGER_TOKEN and DEPLOY_TRIGGER_URL (the pipeline trigger endpoint).
# Usage: trigger-deploy.sh <staging|production> <image or version>
set -euo pipefail
target=${1:?target}; value=${2:?image or version}
case "$target" in
  staging) variable=BAUHERR_IMAGE;;
  production) variable=BAUHERR_VERSION;;
  *) echo "::error::unknown target $target"; exit 1;;
esac
curl -fsS --max-time 30 -X POST "${DEPLOY_TRIGGER_URL:?}" \
  --form-string "token=$DEPLOY_TRIGGER_TOKEN" --form-string "ref=main" \
  --form-string "variables[BAUHERR_TARGET]=$target" --form-string "variables[$variable]=$value" | jq -r '"deploy pipeline: " + .web_url'
