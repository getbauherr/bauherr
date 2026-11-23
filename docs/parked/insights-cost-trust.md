# Insights, Trust grade and cost analytics

Cut from the lean core on 2026-11-19. The code is at the git tag `legacy-final`.

## What it did

- `/insights` with range 7, 30 or 90 days and a Product filter: tiles Done, lead time (median, 85th percentile), cycle time (median), share of lead time by phase (In progress, Waiting for you, Waiting for CI, Queued); time per stage as stacked bars; one bottleneck sentence; throughput per week; WIP age; a Team section (time and Runs per role, per session).
- Trust grade A to D per Ticket (`ticketTrust`): four groups, Checks, Proof, Review, Interventions. Each is pass, fail or unknown. The grade is A minus one step per failed group, capped at D. Review fails after more than 1 send-back (`MAX_CLEAN_REVIEW_ROUNDS`). An intervention is a human action outside the planned gates.
- Per Product (`loadTrust`): interventions per Ticket, rework rate, send-backs by stage and by review or human, cost per change, reverts among the last 100 merged PRs, escaped defects (a bug Ticket with `causedBy` created within 30 days of the cause closing), grade counts, and an "earned autonomy" line (28 days, at least 5 done, 0 escaped, rework under 5 %).
- Cost: one table `usage_entries` with source `gateway`, `session-reported` or `chat`. Breakdowns by Product, Ticket, stage, role, model and session, each adding up to the total. Missing parts have labels ("Runner, no role", "Chat", "No stage", "Not recorded"). A Ticket cost was labelled "estimated" unless the gateway priced it; Runs without usage counted as unreported, not $0.
- Cost hook `pack/hooks/report-usage.ts` (`Stop`, `SubagentStop`) posted cumulative per-model totals to `POST /api/usage`; the server stored only the delta per Claude session. `npx bauherr hook install` set it up.
- Reconciliation: `reconcile-costs` ran 5 minutes after a Run (retry 10 minutes), summed the gateway `request_logs` per model by `attributes_json->>'run'`, and replaced the Run's rows. `watch-gateway` (every minute) did sessions, `refresh-prices` (hourly) the price catalog, `prune-request-logs` (03:00, 180 days).
- Settings > AI usage: budget bars (USD or tokens, rolling 30 days), providers, tier-to-model map, cost per Product, Ticket and stage.

## The requirement behind it

- Show time to market and where it goes, not only counts (#489).
- Know what a Ticket, a role, a stage and a model cost, and how much is measured (#503, #523).
- Check the Runner's cost estimate against what the gateway billed (#73, `docs/research/audit-cost-model.md`, #18).
- Show whether a merged change can be trusted and when Review may rely on proof (#705).

## Where the code is

- `apps/server/src/lib/`: `trust.ts` (120), `cost.ts` (166), `reconcile.ts` (102), `prices.ts` (225), `session-usage.ts` (148), `gateway.ts`, `history.ts` (`flow`, phases).
- `apps/server/src/app/(app)/lib/`: `insights.ts` (186), `cost.ts` (173), `usage.ts` (63), `cost-labels.ts`; routes `(shell)/insights/page.tsx`, `(shell)/settings/usage/page.tsx`, `app/api/usage/`.
- UI: `components/insights/` (InsightsView, CostSection, TrustSection), `components/TrustCard.tsx`, cost block on the Ticket page.
- Jobs in `apps/server/src/jobs/index.ts`: `reconcile-costs`, `watch-gateway`, `refresh-prices`, `prune-request-logs`.
- Collections in `apps/server/src/collections.ts`: `usage_entries` (unique per run, source, model), `usage_cursors`, `ticket_events`; fields `runs.gatewayCostUsd`, `costEstimateUsd`, `costSource`.
- Pack: `pack/hooks/report-usage.ts`; MCP `usage` argument on `heartbeat`, `finish_run`, `submit_review`, `submit_triage`; chat tool `cost_summary`.
- Tests in `apps/server/tests/`: `trust.test.ts`, `insights.test.ts`, `cost*.test.ts`, `reconcile.test.ts`, `prices.test.ts`, `session-usage.test.ts`, `report-usage-hook.test.ts`, `usage.test.ts`, `ticket-cost-admin.test.ts`, `migrations-usage-entries.test.ts`.
- Docs: `docs/cost.md`, `docs/research/audit-cost-model.md`, `docs/gateway.md`.

## Why it was cut

The lean core records cost per run and shows two health numbers (first-pass accept rate, exception rate). The full analytics return as a module. The owner wants this back as a later module.

## What a module on the new core needs

- Core contracts: the append-only event log per ticket (lead and cycle time, send-backs, interventions come from events), the Ticket record (`findings`, `result`, `risk`), the Run result with its cost, and the mirror (CI, merged PRs, reverts).
- Liftable almost unchanged: `gradeOf`, `passOf`, `isBug`, `isIntervention`, `earnedAutonomy`, `quantile`, `bottleneckSentence`, `costSplit`, `priceOf`, `parseUsage`, `reconcileRun`'s per-model SQL, `report-usage.ts`.
- To design again: phase times (`flow` in `history.ts`) must come from the new events; `ticketTrust` reads Runs, `ticket_events` and the proof store, which change; "interventions" must follow the new Cards (a card answer is planned, a manual forge action is not).
- Traps: a gateway-priced Run ignores its `session-reported` rows; hook deltas need a cursor per Claude session and a baseline for history before `connect` (15 minute rule); gateway cost can be null for unpriced models, so tokens and cost need separate counts; the median cost query and `loadReverts` hit the forge (4 s timeout, return null); reconcile needs `GATEWAY_DATABASE_URL` and a delay because logs arrive late; whether the gateway version supports every logged field was "unknown" in the audit.
- Seen in souls-house ([allowance brake](https://github.com/swombat/souls-house/blob/master/docs/features/allowance-brake.md)): a budget brake stops only work the factory started itself (backlog Briefs); work a person asked for continues. Unknown usage does not count as nothing left. The owner gets one notice per budget window, not one per skipped run.
