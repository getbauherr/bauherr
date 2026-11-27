#!/usr/bin/env bash
# Starts the services pipeline (GitLab trigger) that deploys Bauherr. Needs SERVICES_TRIGGER_TOKEN and SERVICES_TRIGGER_URL (the pipeline trigger endpoint of the services project).
# Usage: trigger-services.sh <staging|production> <image or version>
set -euo pipefail
target=${1:?target}; value=${2:?image or version}
case "$target" in
  staging) variable=BAUHERR_IMAGE;;
  production) variable=BAUHERR_VERSION;;
  *) echo "::error::unknown target $target"; exit 1;;
esac
curl -fsS --max-time 30 -X POST "${SERVICES_TRIGGER_URL:?}" \
  --form-string "token=$SERVICES_TRIGGER_TOKEN" --form-string "ref=main" \
  --form-string "variables[BAUHERR_TARGET]=$target" --form-string "variables[$variable]=$value" \
  --form-string "variables[SAST_DISABLED]=true" | jq -r '"services pipeline: " + .web_url'
