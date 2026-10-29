#!/bin/sh
# PreToolUse(Bash|WebFetch|WebSearch): deny network tools unless the target is the gateway.
# Not a security boundary (the worker container's egress rules are); this gives the agent a clear message.
set -eu
input=$(cat)
: "${BAUHERR_GATEWAY_HOST:?not set}"

tool=$(printf '%s' "$input" | jq -r '.tool_name')
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // .tool_input.url // ""')

decide() { printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"%s","permissionDecisionReason":"%s"}}\n' "$1" "$2"; }

case "$tool" in
  WebFetch|WebSearch) decide deny "network tools are disabled; egress only via the gateway" ;;
  *)
    # TODO: robust parsing; today a coarse match on common network clients and git remotes.
    if printf '%s' "$cmd" | grep -Eq '(^|[ ;|&])(curl|wget|nc|ssh|scp|git (push|clone|fetch|pull))( |$)' \
       && ! printf '%s' "$cmd" | grep -Fq "$BAUHERR_GATEWAY_HOST"; then
      decide deny "network access only to the gateway; see rules/egress.md"
    else
      decide allow "no network use detected"
    fi ;;
esac
