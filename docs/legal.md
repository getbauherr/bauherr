# Legal notes for operators

Not legal advice. Check your own situation with a lawyer.

## What leaves the instance

| To whom | What | Why |
|---|---|---|
| The Workspace's own LLM provider, through the bundled gateway | Prompts, code and context of Runs | Agents need a model |
| The forge (GitHub, GitLab) | API calls with the Workspace's forge credential | Read and change Tickets, push branches, open MRs |

Nothing else leaves by default. The optional observability and router profiles run inside the instance.

## Provider credential per Workspace

Every Workspace must use its own provider credential. One shared key across Workspaces is not allowed.

Bauherr runs Claude Code via the Claude Agent SDK, which is under Anthropic's Commercial Terms, not Apache-2.0 ([terms](https://code.claude.com/docs/en/legal-and-compliance)). The relevant rules:

> Customers may not pay for, resell, or intermediate Claude usage on their end users' behalf. Each end user must authenticate with their own Anthropic API key, Claude subscription plan credentials, or 3P inference provider credential (Amazon Bedrock, Google Cloud's Agent Platform, Microsoft Foundry).

Subscription credentials are allowed by Anthropic only for a person signing in to the unmodified Claude Code binary; Bauherr's Runner therefore uses API keys only.

- Use API keys only. Never use subscription or OAuth credentials.
- Developers may not collect or store Claude.ai credentials.
- If you operate Bauherr for a client, the client's key is used and billed to the client.

Bauherr ships the SDK and Claude Code binary unmodified. Do not modify them or remove or restrict a built-in auth method.

## Owner-session passthrough

The gateway's `sub/*` model family forwards the caller's own `Authorization` header to Anthropic. It is only for the Workspace owner's own, unmodified Claude Code session. Never for Product users, clients or spawned agents (the Runner uses `ws-<slug>/*` with the Workspace API key only). Bauherr never collects, stores or logs the token:

- `deploy/gateway/config.yaml.tmpl`: `sub/*` has no `params.apiKey`, only `auth.passthrough` of the request header; `x-agw-key` is removed before upstream.
- `frontendPolicies.accessLog` adds only run, stage, product and ticket headers; `database.llm` stays `metadata`, so no header or prompt is persisted.
- Only keys with `metadata.kind: owner-session` (`allowedModels: ["sub/*"]`, created by `ensureSessionKey`) pass the `sub/*` authorization rule.

## What is stored

- The gateway stores no prompts. `accessLog.database.llm` is never set to `full`.
- Request logs (tokens, cost, trace id, run and ticket headers) are pruned after 180 days.
- Intake stores an email address for the magic link. Cover this in your privacy notice as the controller.
- Provider-side retention and data processing follow the Workspace's agreement with its provider. Sign the provider's data processing terms.

## Egress policy

The providers allowed per Workspace are the egress policy. A Workspace reaches only the providers configured for it; the Workspace's credential never reaches an agent.

## Optional dashboards profile

If you add a dashboards stack licensed under AGPL-3.0 (such as Grafana or Loki), run the unmodified upstream images as separate services. Bauherr does not link to them. If you modify them, you must offer your changes under the AGPL.

## Trademarks

"Bauherr" is a project name; Apache-2.0 Section 6 grants no trademark rights. "Claude" and "Claude Code" are trademarks of Anthropic. You may say in plain text that Bauherr runs Claude Code. Do not use their names or logos in a product name or logo, or imply endorsement.

See [NOTICE](../NOTICE) for third-party licences.
