# Router profile (vLLM Semantic Router)

Optional. It adds the tier `auto`: one model name, `ws-<slug>/router/auto`. Behind it the [vLLM Semantic Router](https://github.com/vllm-project/semantic-router), vllm-sr v0.4.0 pinned, picks the Workspace's `cheap`, `standard` or `strong` model per request. Nothing changes for a Workspace without a `router` Connection or for any other tier.

## Enable

```bash
docker compose --profile router up -d
```

Then, as an Admin, add an LLM Connection with the preset `router` to the Workspace. It needs no secret. Without the profile nothing router-related runs and no weights are downloaded.

| Service | Image | Role |
|---|---|---|
| `router-core` | `ghcr.io/vllm-project/semantic-router/vllm-sr:v0.4.0` | ExtProc: classifies the request, rewrites the model |
| `router` | `envoyproxy/envoy:v1.35.3` | Front on `http://router:8801`, no published port. Config in `deploy/router/envoy.yaml`. |

The first start downloads the classifier models into the volume `bauherr-router`, mounted at `/app/models`. Expect about 2.5 GB and a few minutes. Later starts reuse it. `router-core` is healthy once `/ready` answers.

## Key flow

1. The Runner calls the gateway with the Workspace key and model `ws-<slug>/router/auto`. The gateway strips the prefix and forwards model `auto` to `http://router:8801/v1`.
2. The router picks a tier model and calls the gateway at `gateway:4000` with a **router key**, never the Workspace key. vllm-sr cannot forward the inbound `Authorization`, only a static per-backend `api_key`.
3. The router key is created with the first `router` Connection and stored encrypted on the Workspace. The last `router` Connection revokes it. It is never shown or logged.
4. Its `allowedModels` are the Workspace's tier models, never `.../auto`, so the router cannot call itself. They are re-applied when the tiers or the budget change.
5. Bauherr writes the router config to `/gateway/router/config.yaml` with mode 0600, while a `router` Connection exists. It holds the router key.

Categories map to tiers:

| Tier | Categories |
|---|---|
| `strong` | math, physics, chemistry, engineering, law |
| `standard` | computer science, business, economics, health, biology |
| `cheap` | everything else |

## Spend attribution

Both keys carry `user = workspace-<slug>`, so outer and inner requests appear in `request_logs` under that user. The outer `auto` request has no price. The cost is on the inner request. Token counts show on both rows, so sum only the inner rows for spend.

## Budget split

The Workspace budget B is shared by both keys. The Workspace key gets `100 - routerBudgetShare` percent of B. The router key gets `routerBudgetShare` percent. Set it under Settings > General, from 1 to 99, default 20, shown while a router Connection exists.

- Amounts round down, so the two limits never sum to more than B.
- Each key is a `Block` budget. `auto` traffic is refused with 429 once the router share is spent, even with direct budget left, and the other way round.
- Without a router Connection the Workspace key carries all of B. Adding or removing the Connection, or changing the share, re-renders both keys.

The split is needed because agentgateway v1.7.0 cannot share a budget. A budget belongs to one API key (see [`budget_id`](https://github.com/agentgateway/agentgateway/blob/v1.7.0/crates/agentgateway/src/http/budget/mod.rs) and [`LocalAPIKey::into_parts`](https://github.com/agentgateway/agentgateway/blob/v1.7.0/crates/agentgateway/src/http/apikey.rs)). There is no user-level budget. A router key on `Audit` would leave `auto` unbounded.

## Limits

- One Workspace per instance. A second Workspace with a `router` Connection is rejected.
- `auto` is selected per stage config only. There is no settings UI for it.
- The category mapping is fixed in `renderRouter` in `apps/server/src/lib/gateway.ts`. There is no custom tuning.
- The router reads its config at start. After the first `router` Connection or a tier change, restart `router-core` if it does not pick the file up.

## Smoke result

An isolated smoke on 2026-11-09 used vllm-sr v0.4.0, Envoy v1.35.3 and a fake OpenAI-compatible service as `gateway:4000`.

- `router-core` downloaded its models once and was ready about 20 s later.
- An `auto` request reached the gateway as `POST /v1/chat/completions` with the router key. The caller's key does not travel to the inner call.
- A coding prompt went to `standard`, a math prompt to `strong`, a general prompt to `cheap`.

Not measured yet: the real gateway's `request_logs` for one outer and one inner request. That needs a provider key and is the first check on a live `--profile router` install.
