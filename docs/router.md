# Router profile (vLLM Semantic Router)

Optional. Adds the tier `auto`: one model name, `ws-<slug>/router/auto`, behind which the [vLLM Semantic Router](https://github.com/vllm-project/semantic-router) (vllm-sr v0.4.0, pinned) picks the Workspace's `cheap`, `standard` or `strong` model per request. Nothing changes for a Workspace without a `router` Connection or for any other tier.

## Enable

```sh
docker compose --profile router up -d
```

Then, as an Admin, add an LLM Connection with the preset `router` to the Workspace (no secret). Without the profile nothing router-related runs and no weights are downloaded.

| Service | Image | Role |
|---|---|---|
| `router-core` | `ghcr.io/vllm-project/semantic-router/vllm-sr:v0.4.0` | ExtProc: classifies the request, rewrites the model. |
| `router` | `envoyproxy/envoy:v1.35.3` | Front on `http://router:8801`, no published port. Config: `deploy/router/envoy.yaml`. |

First start downloads the router's classifier models into the volume `bauherr-router` (`/app/models`); later starts reuse it. Expect a few hundred MB and a few minutes; `router-core` is healthy once `/ready` answers.

## Key flow

1. The Runner calls the gateway with the Workspace key and model `ws-<slug>/router/auto` (outer call). The gateway strips the prefix and forwards model `auto` to `http://router:8801/v1` (chat completions).
2. The router picks a tier model and calls the gateway at `gateway:4000` (inner call) with a **router key**, never the Workspace key. vllm-sr cannot forward the inbound `Authorization`, only a static per-backend `api_key`, hence a dedicated key.
3. The router key is created with the first `router` Connection (once per Workspace), stored encrypted on the Workspace like the gateway key, and revoked with the last `router` Connection. It is never shown or logged. Its `allowedModels` are the Workspace's tier models (`ws-<slug>/<tier model>`), never `.../auto`, so the router cannot call itself. It is re-applied when the tiers or the budget change.
4. Bauherr writes the router config to `/gateway/router/config.yaml` (0600, holds the router key) while a `router` Connection exists and removes it with the last one. Categories: `math, physics, chemistry, engineering, law` go to `strong`, `computer science, business, economics, health, biology` to `standard`, everything else to `cheap`.

## Spend attribution and double counting

Both keys carry `user = workspace-<slug>`, so outer and inner requests appear in `request_logs` under that user. The outer `auto` request has no price (no catalog entry); the cost of the model call is on the inner request (router key). Token counts of one call show up on both rows: sum only the inner rows for spend. If the smoke shows the router key's own budget doubling the Workspace budget, switch it to `Audit` (decision D4).

## Limits

- One Workspace per instance: a second Workspace with a `router` Connection is rejected.
- `auto` is selected per stage config only; there is no settings UI for it.
- The category mapping is fixed in `renderRouter` (`apps/server/src/lib/gateway.ts`); no custom tuning or training.
- The router config is read at start. After the first `router` Connection, or after changing tiers, restart `router-core` if the router does not pick the file up.

## Smoke result

Isolated smoke on 2026-11-09 (vllm-sr v0.4.0, Envoy v1.35.3 from `deploy/router/envoy.yaml`, a config in the shape `renderRouter` writes, and a fake OpenAI-compatible service as `gateway:4000` that logs each request):

- `router-core` accepted the config, downloaded its classifier models (about 2.5 GB in the models volume, once) and was ready about 20 s after the download.
- One `auto` request per prompt through Envoy on `:8801`, sent with a Workspace-style key, reached the gateway as `POST /v1/chat/completions` with `Authorization: Bearer <router key>`: the caller's key does not travel to the inner call.
- Routing: a coding prompt went to the `standard` tier model, a math prompt to `strong`, a general prompt to `cheap`.

Not measured yet: the real gateway's `request_logs` for one outer and one inner request, and so the double counting of decision D4. That needs a provider key and is the first check on a live `--profile router` install.
