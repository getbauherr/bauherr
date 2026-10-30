# Bauherr

**Bauherr** (German for the client who commissions a building and approves the work, not the builder) — an open-source AI software factory. Connect your repos and boards; agents take tickets through gated stages (spec → build → review → release) with human approvals, audit, and cost per workspace. Self-hosted, Postgres-only, one command to start.

## Status

Pre-release. Architecture and v0.1 spec are being charted in [Bauherr v0.1 — way to a locked architecture and spec](https://github.com/getbauherr/bauherr/issues/1).

The stack ships its own LLM gateway with per-Workspace budgets. Bauherr runs Claude Code via the Claude Agent SDK; see [docs/legal.md](docs/legal.md) for operators.

UI routes, theming and e2e: [docs/ui.md](docs/ui.md). Sign-in and optional OIDC: [docs/auth.md](docs/auth.md).

## Licence

[Apache-2.0](LICENSE). See [CONTRIBUTING.md](CONTRIBUTING.md).

Admin functions (API key, audit, workflow, factory health) are pages of the UI. Payload's `/admin` is a developer escape hatch only; set `BAUHERR_DISABLE_ADMIN=1` to switch it off.
