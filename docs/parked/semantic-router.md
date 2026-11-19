# Semantic router

Cut from the lean core on 2026-11-19. The code is at the git tag `legacy-final`.

## What it did

- Optional compose profile `router` (`docker compose --profile router up -d`) added the model name `ws-<slug>/router/auto`. The vLLM Semantic Router (`vllm-sr` v0.4.0, ExtProc) behind an Envoy front (v1.35.3, `http://router:8801`, no published port) picked the Workspace's `cheap`, `standard` or `strong` model per request.
- Enabled by adding an LLM Connection with the preset `router` (no secret) as an Admin. Without that Connection nothing changed for any Workspace.
- Fixed category map: `strong` = math, physics, chemistry, engineering, law; `standard` = computer science, business, economics, health, biology; `cheap` = the rest.
- Key flow: the Runner called the gateway with the Workspace key; the gateway forwarded model `auto` to the router; the router called the gateway again with a separate router key (vllm-sr cannot pass the inbound `Authorization`). The router key was created with the first `router` Connection, stored encrypted, revoked with the last one, and limited to the Workspace tier models (never `auto`).
- Budget split: the gateway cannot share a budget between keys. Workspace budget B was split by `routerBudgetShare` (1 to 99, default 20, Settings > General): router key gets that percent, Workspace key the rest, amounts rounded down. Each key was a `Block` budget, so either side got 429 when its share was spent.
- Spend: both keys carry `user = workspace-<slug>`. The outer `auto` request has no price; sum only inner rows.
- First start downloaded about 2.5 GB of classifier models into volume `bauherr-router`; `router-core` is healthy when `/ready` answers.
- Limits at the tag: one Workspace per instance (a second `router` Connection is rejected); `auto` selectable in stage config only; no category tuning.

## The requirement behind it

- Pick a cheaper or stronger model per request without the engineer choosing a tier (#58, `feat(router)` in #431).
- Keep the per-Workspace key and budget enforced for routed traffic too (#438, #442, #449).

## Where the code is

- `compose.yaml`: services `router-core`, `router`, volume `bauherr-router`. `deploy/router/envoy.yaml` (54 lines).
- `apps/server/src/lib/gateway.ts` (377 lines, also the kept gateway code): `tierModels` (adds `auto`), `ensureRouterKey`, `syncRouterKey`, `revokeRouterKey`, `renderRouter`, `ROUTER_DOMAINS`, `routerShare`, `shareOf`, `budget`, `DEFAULT_ROUTER_SHARE`.
- `apps/server/src/lib/providers.ts`: preset `router`. `apps/server/src/collections.ts`: Workspace fields `routerKey` (line 221) and `routerBudgetShare` (line 241), the second-Workspace check (line 421). Migration `apps/server/src/migrations/20261109_130000_router_key.ts`.
- UI: `apps/server/src/app/(app)/lib/usage.ts`, `apps/server/src/app/(app)/lib/settings.ts`, `apps/server/src/app/(app)/(shell)/settings/models/page.tsx`.
- Test: `apps/server/tests/router.test.ts` (196).
- Docs: `docs/router.md` (65).
- `apps/server/src/lib/route.ts` (32) is stage routing (`routeEntry`, skipping stages by `when`), not the model router.

## Why it was cut

The lean core maps three roles to fixed model tiers through the gateway. Automatic routing is not needed for that.

## What a module on the new core needs

- Contracts: none on the record or the lifecycle. It is infrastructure behind the gateway; the Run contract only names a model.
- Lift almost unchanged: `deploy/router/envoy.yaml`, the two compose services, `renderRouter`, `shareOf`, `ensureRouterKey`, `revokeRouterKey`, and `docs/router.md` (the key flow and budget reasoning).
- Design again: how a role's tier resolves to `auto`; where the per-Workspace router share is configured; a smoke against the real gateway.
- Traps: vllm-sr needs a static `api_key`, hence the second key and the budget split; the router key's allowed models must exclude `auto` or the router calls itself; the router reads its config at start, so restart `router-core` after the first Connection or a tier change; `router-core` restarts until the config file exists. The doc states one open item: the real gateway's `request_logs` for one outer and one inner request were not measured.
