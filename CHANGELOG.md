# Changelog

All notable changes to this project are documented in this file. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

## 0.5.0 - 2026-11-17

Promoted from v0.5.0-rc.2 (commit 902a319).

### Changed behaviour
- The plan approval gate is on by default: every plan waits for the owner's approval before Build starts. It was off silently. An installation that wants plans to pass without it removes `gate: human` from the `plan` stage of its factory file (Settings > Workflow, or `bauherr apply`).

## 0.3.0

### Features
- `OIDC_BAUHERR_ROLE`: when set, SSO sign-in is refused (`/login?error=oidc-role`) unless the role claim maps to admin, product-owner or this value; an existing SSO account that no longer maps is refused and its sessions end. Unset keeps today's behaviour. ([#542](https://github.com/getbauherr/bauherr/issues/542))
- `OIDC_PRODUCT_OWNER_ROLE`: maps a role claim value to `product-owner` (not in 0.2.x).

## 0.2.0 - 2026-11-09

### Features
- Upgrade agentgateway v1.6.0 → v1.7.0 ([#444](https://github.com/getbauherr/bauherr/issues/444))

## 0.1.1 - 2026-11-09

### Features
- Router profile: vLLM Semantic Router and auto tier ([#58](https://github.com/getbauherr/bauherr/issues/58))
- measure PR wall time after the build-once change (#294 follow-up) ([#347](https://github.com/getbauherr/bauherr/issues/347))
- Releases page and manual mode ([#405](https://github.com/getbauherr/bauherr/issues/405))
- Payload's REST sign-in /api/bauherren/login bypasses the sign-in queue and its cap ([#428](https://github.com/getbauherr/bauherr/issues/428))
- stable 'released before', one date source, retry-safe ship e2e ([#430](https://github.com/getbauherr/bauherr/issues/430))
- docs/auth.md: say when the IP limit is trustworthy (TRUSTED_PROXY_HOPS) ([#432](https://github.com/getbauherr/bauherr/issues/432))
- Lows from #347 and #430, plus #347's 10-run CI measurement (2026-11-09) ([#436](https://github.com/getbauherr/bauherr/issues/436))
- Follow-ups from #58: migrations crash on newer Workspace columns; router doubles the gateway budget ([#438](https://github.com/getbauherr/bauherr/issues/438))
- npm trusted publishing fails with E401 (setup-node registry-url placeholder token) ([#439](https://github.com/getbauherr/bauherr/issues/439))

## 0.1.0 - 2026-11-09

### Features
- Docs site and domain ([#25](https://github.com/getbauherr/bauherr/issues/25))
- Add CHANGELOG.md ([#70](https://github.com/getbauherr/bauherr/issues/70))
- pick up tickets without a stage label ([#76](https://github.com/getbauherr/bauherr/issues/76))
- Notify the owner at human gates ([#77](https://github.com/getbauherr/bauherr/issues/77))
- Review stage: factory code review and auto-merge ([#82](https://github.com/getbauherr/bauherr/issues/82))
- Release stage: staging deploy, result summary, acceptance gate ([#83](https://github.com/getbauherr/bauherr/issues/83))
- Production deploy gate: manual approval ([#84](https://github.com/getbauherr/bauherr/issues/84))
- Parent tickets: approval inheritance and grouping for sub-tickets ([#100](https://github.com/getbauherr/bauherr/issues/100))
- Release notes on GitHub and GitLab at production release ([#106](https://github.com/getbauherr/bauherr/issues/106))
- Backlog order: owner rank, claim_next, finish before start ([#114](https://github.com/getbauherr/bauherr/issues/114))
- dependency graph view with critical path ([#118](https://github.com/getbauherr/bauherr/issues/118))
- GitLab driver: issues, merge requests and pipelines behind the adapter contracts ([#119](https://github.com/getbauherr/bauherr/issues/119))
- bauherr CLI package and release workflow (npx bauherr up) ([#123](https://github.com/getbauherr/bauherr/issues/123))
- submit_review rejects finding paths with parentheses (Next.js route groups) ([#127](https://github.com/getbauherr/bauherr/issues/127))
- Factory MRs must not auto-close Tickets (acceptance gate skipped) ([#132](https://github.com/getbauherr/bauherr/issues/132))
- a restart mid-request records the verdict but leaves the Ticket in review ([#133](https://github.com/getbauherr/bauherr/issues/133))
- Release watch: respect a deliberate close after merge; bound the closed-ticket scan ([#135](https://github.com/getbauherr/bauherr/issues/135))
- Review → Build: worklog rewrite drops sections and low findings ([#137](https://github.com/getbauherr/bauherr/issues/137))
- Sub-tickets follow-ups: duplicate child rows, inheritance record, close retry, label ([#138](https://github.com/getbauherr/bauherr/issues/138))
- Review round cap: owner can grant one more round from the UI ([#140](https://github.com/getbauherr/bauherr/issues/140))
- Gates and triage follow-ups: silent gate when owners are unreachable, small races ([#142](https://github.com/getbauherr/bauherr/issues/142))
- Provider auth modes: inline AWS IAM and Entra, ambient single-tenant ([#143](https://github.com/getbauherr/bauherr/issues/143))
- Several providers per Workspace and per-tier provider ([#144](https://github.com/getbauherr/bauherr/issues/144))
- Intake engine and session API ([#145](https://github.com/getbauherr/bauherr/issues/145))
- Intake UI: New request chat ([#146](https://github.com/getbauherr/bauherr/issues/146))
- Intake screenshots ([#147](https://github.com/getbauherr/bauherr/issues/147))
- Owner questions via the intake engine for wayfinder tickets ([#148](https://github.com/getbauherr/bauherr/issues/148))
- Embeddable widget and embed token ([#149](https://github.com/getbauherr/bauherr/issues/149))
- Knowledge sources, index and search ([#150](https://github.com/getbauherr/bauherr/issues/150))
- Knowledge page: browse, search, read, write-backs ([#151](https://github.com/getbauherr/bauherr/issues/151))
- Knowledge editor: edit via PR with auto-merge ([#152](https://github.com/getbauherr/bauherr/issues/152))
- Agent identity: sessions must not hold the owner's gate rights ([#166](https://github.com/getbauherr/bauherr/issues/166))
- Merge conflicts after another merge go back to Build (merge main), not to merge-failure escalation ([#168](https://github.com/getbauherr/bauherr/issues/168))
- Atomic state guards: replace payload.update-by-where CAS (staging claim and others) ([#169](https://github.com/getbauherr/bauherr/issues/169))
- Unclaimed session Runs must not expire to needs_human ([#170](https://github.com/getbauherr/bauherr/issues/170))
- Forge approval labels must come from a human gate owner (verify the label actor) ([#174](https://github.com/getbauherr/bauherr/issues/174))
- Human gates: only refinement and production by default, configurable per workflow ([#175](https://github.com/getbauherr/bauherr/issues/175))
- e2e/triage.spec.ts fails on main (seed ticket maps to the wrong forge issue) ([#180](https://github.com/getbauherr/bauherr/issues/180))
- flaky 'a claim race has one winner' test; find out whether claims can double-win ([#392](https://github.com/getbauherr/bauherr/issues/392))
- a Ticket parked 'ready for human' never gets a new review after a new head ([#393](https://github.com/getbauherr/bauherr/issues/393))
- a locked account's password sign-in token keeps working ([#399](https://github.com/getbauherr/bauherr/issues/399))
- two concurrent sign-ins of one user drop a session ([#401](https://github.com/getbauherr/bauherr/issues/401))
- Release shipping: forge tag, release and ancestry ([#404](https://github.com/getbauherr/bauherr/issues/404))
- report e2e tests that only pass on retry ([#406](https://github.com/getbauherr/bauherr/issues/406))
- Next-step bar: a button for every need, and link every Ticket the reason names ([#407](https://github.com/getbauherr/bauherr/issues/407))
- flaky e2e owner-chat.spec.ts:21 (answer a decision with a suggestion chip) ([#411](https://github.com/getbauherr/bauherr/issues/411))
- a session declares the stages it works, so an unclaimed Review doesn't block Builds ([#416](https://github.com/getbauherr/bauherr/issues/416))
- Review lows from #399, #404 and #406 (2026-11-09) ([#417](https://github.com/getbauherr/bauherr/issues/417))
- Review lows from #401, #407 and #416 (2026-11-09, batch 2) ([#421](https://github.com/getbauherr/bauherr/issues/421))
- the Postgres pool has no size or timeout set, so pool exhaustion hangs the whole app ([#422](https://github.com/getbauherr/bauherr/issues/422))
- Sign-in queue: cap waiters per account, and test the sign-in action itself ([#424](https://github.com/getbauherr/bauherr/issues/424))

### Added

- Release publishing at the production gate: one forge Release per approved batch (`products.releaseMode` `notes-only` or `factory`), user-language notes, `releaseUrl` on Tickets, CHANGELOG MR in factory mode (#106).
- Security: MCP sessions authenticate with agent keys (`/settings/api-key`); gate tools (`approve`, `accept_staging`, `grant_review_round`, `stop_review`, `request_changes`) refuse them. Existing personal API keys are disabled by migration: mint an agent key and re-add the MCP server ([session mode](docs/session-mode.md#agent-identity)). Refs #166.
