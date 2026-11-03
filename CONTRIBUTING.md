# Contributing

Contributions are licensed under Apache-2.0 (Section 5: inbound = outbound). No CLA, no sign-off.

Open an issue before large changes. Report vulnerabilities as described in [SECURITY.md](SECURITY.md), not in public issues.

State guards never use `payload.update` with `where` (find-then-update, not atomic). Use one conditional `UPDATE ... RETURNING`, via `cas()` for Tickets, and act only on a returned row. `apps/server/tests/state-guards.test.ts` enforces it.

AI chat UIs use [assistant-ui](https://www.assistant-ui.com/elements/) (`@assistant-ui/react`, an approved dependency) as much as possible; see the Chat pattern in [docs/design/README.md](docs/design/README.md).
