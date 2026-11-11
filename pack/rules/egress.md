---
globs: ["**"]
applies: every Run
---

# Egress

Code and context leave the Run only through the gateway to the providers the Workspace allows.

## Rules
1. **LLM traffic** goes to the gateway (`ANTHROPIC_BASE_URL`). Never call a provider directly; never read or ask for a provider credential.
2. **Allowed destinations** are the gateway and the Product's forge via the adapter tools (`mcp__forge__*`). In an autonomous Run the Runner pushes; you do not.
3. **External services** (APIs, SaaS, package registries beyond the Product's lockfile mirror, paste sites, web search) need Bauherr approval. Request it as a blocker naming the service, the data sent and why.
4. **No code or context in third-party tools**: no uploading files, diffs, logs or Ticket text to any service not approved.
5. **Secrets**: never print, copy or transmit environment variables or credential files. The agent holds no forge credential.
6. **Workspace policy** may narrow this (provider allow-list); the narrower rule wins.

## Enforcement
- Autonomous Runs: the Runner's egress guard (`packages/runner/src/guards.ts`) denies network tools except the gateway. It is a guide, not a boundary. `hooks/egress-guard.sh` is a reference stub, not active.
- Session Runs: not enforced, by convention; the session runs on the person's own machine.
- Gateway logs carry `X-Bauherr-Run` per Run for audit.

## When blocked
Declare a blocker (`run-contract`) with: service, data, reason, recommended default (usually "do without").
