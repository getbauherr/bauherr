# Bedrock, Vertex and Foundry behind `runStage`

Ticket: getbauherr/bauherr#59 (decision D1). Researched 2026-11-09 against `@anthropic-ai/claude-agent-sdk` 0.3.312
(bundles Claude Code 2.1.312, pinned in `pnpm-lock.yaml`) and agentgateway v1.7.0 (pinned in `compose.yaml`).
Builds on `runner-execution-model.md` (SDK options, env scrub; not repeated). Out of scope: session mode (#63), the
OpenAI-compatible loop (D1).
Tags: **[verified]** = read in this repo, in the installed SDK (`sdk.d.ts`, `sdk.mjs`, strings of the bundled
`claude` binary) or in the agentgateway v1.7.0 source at tag `v1.7.0`; no process was run; **[docs]** = official
docs (URLs in 8); **[types]** = `sdk.d.ts` only; **[unverified]** = inference or not smoke-tested. No cloud call was
made and no credential was used: everything about runtime behavior against AWS, GCP or Azure is [unverified].

## 1. Seam

The agent already speaks the Anthropic Messages API to one place. `agentEnv` (`packages/runner/src/agent.ts`) hands
the SDK child exactly `PATH`, `HOME`, `ANTHROPIC_BASE_URL` (the Runner's localhost proxy), `ANTHROPIC_API_KEY='proxy'`
and `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` [verified]. `startProxy` (`proxy.ts`) replaces the auth header with the
Workspace gateway key and adds `x-bauherr-run|stage|product|ticket` [verified]. The model is
`ctx.connection.modelByTier[tier]`, passed through verbatim (`buildOptions`) [verified]. Provider choice is a
gateway concern: `PRESETS` in `apps/server/src/lib/providers.ts` renders one `ws-<ws>/<conn>/*` entry per Connection
[verified].

| | (A) Gateway path (today) | (B) SDK-native | Hybrid |
|---|---|---|---|
| Agent env | 5 keys, no cloud credential | `CLAUDE_CODE_USE_*` + `AWS_*` / `GOOGLE_APPLICATION_CREDENTIALS` / `ANTHROPIC_FOUNDRY_API_KEY` in the child env [docs] | `CLAUDE_CODE_USE_BEDROCK` + `ANTHROPIC_BEDROCK_BASE_URL` = proxy + `CLAUDE_CODE_SKIP_BEDROCK_AUTH=1` [docs] |
| Credential location | gateway files / `config.yaml`, never the agent | in the agent env, readable by the agent's Bash (the `printenv`/`env` deny rules are not a boundary, `runner-execution-model.md` 1) | gateway, if the gateway signs |
| Budget, `request_logs` | yes (key budget, header attribution) | none: traffic bypasses the gateway | only if the gateway sees the traffic |
| Test `agent env carries no gateway key and no process env` | green | red by design | green |
| Works with agentgateway v1.7.0 | yes (see 3) | n/a | no, see 3.3 |

Verdict: (A). (B) is rejected (4 and 7). Hybrid is not available on v1.7.0.

## 2. Config per provider (SDK side)

Checked by grepping the installed SDK: every name below is present in the bundled `claude` binary strings and in the
env list of `sdk.mjs` [verified]. `sdk.d.ts` declares none of them except `ANTHROPIC_BEDROCK_BASE_URL` and
`CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` in doc comments, so they are not typed options [types].

- `Options.env` replaces `process.env`: "not merged with `process.env`. Spread `process.env` yourself ..."; omitted
  means the child inherits [types: `sdk.d.ts` `env?` doc comment; behavior also in `runner-execution-model.md`].
  Consequence for (B): the cloud credentials would have to be put into this object by Bauherr.
- Credential variables the bundled CLI treats as secrets (its internal env scrub list) include
  `ANTHROPIC_FOUNDRY_API_KEY`, `ANTHROPIC_FOUNDRY_AUTH_TOKEN`, `AWS_BEARER_TOKEN_BEDROCK`, `AWS_WEB_IDENTITY_TOKEN_FILE`,
  `AWS_CONTAINER_CREDENTIALS_*` [verified].

| Provider | Enable | Required | Endpoint override (gateway use) | Skip client auth | Credentials (client side) |
|---|---|---|---|---|---|
| Bedrock | `CLAUDE_CODE_USE_BEDROCK=1` [verified][docs] | `AWS_REGION` (falls back to `AWS_DEFAULT_REGION`, profile, `us-east-1`) [docs] | `ANTHROPIC_BEDROCK_BASE_URL` [verified][docs] | `CLAUDE_CODE_SKIP_BEDROCK_AUTH` [verified] | SDK default AWS chain, or `AWS_BEARER_TOKEN_BEDROCK` (skips the chain) [docs] |
| Vertex | `CLAUDE_CODE_USE_VERTEX=1` [verified][docs] | `ANTHROPIC_VERTEX_PROJECT_ID`, `CLOUD_ML_REGION` (`global`, `eu`, `us` or a region; default `us-east5`) [docs] | `ANTHROPIC_VERTEX_BASE_URL` [verified][docs] | `CLAUDE_CODE_SKIP_VERTEX_AUTH` [verified] | ADC, `GOOGLE_APPLICATION_CREDENTIALS` file [docs] |
| Foundry | `CLAUDE_CODE_USE_FOUNDRY=1` [verified][docs] | `ANTHROPIC_FOUNDRY_RESOURCE` (resource name only, a URL is refused) or `ANTHROPIC_FOUNDRY_BASE_URL` [verified][docs] | `ANTHROPIC_FOUNDRY_BASE_URL` | `CLAUDE_CODE_SKIP_FOUNDRY_AUTH` [verified] | `ANTHROPIC_FOUNDRY_API_KEY`, `ANTHROPIC_FOUNDRY_AUTH_TOKEN` (wins), or the Azure default chain (Entra) [docs] |

Also present in 0.3.312, not used by Bauherr: `CLAUDE_CODE_USE_MANTLE` (+ `ANTHROPIC_BEDROCK_MANTLE_BASE_URL`,
`CLAUDE_CODE_SKIP_MANTLE_AUTH`), `CLAUDE_CODE_USE_ANTHROPIC_AWS`, `CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD`,
`CLAUDE_CODE_USE_GATEWAY` [verified].

Model IDs and tiers:
- Native mode uses the provider's own IDs (`us.anthropic.claude-opus-4-8`, `claude-sonnet-5@...`, a Foundry deployment
  name) and maps the `opus`/`sonnet`/`haiku` aliases through `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL` [verified
  names; docs for semantics]. Bauherr does not use aliases: `modelByTier` holds the concrete ID, so the mapping is
  irrelevant to (A).
- Behind `ANTHROPIC_BASE_URL` (A) Claude Code sends the ID verbatim. An ID it does not recognize (every Bedrock
  profile ID and Foundry deployment name that is not a known Anthropic ID) is treated as a current model: it gets
  adaptive thinking, mid-conversation system messages and the full `anthropic-beta` set [docs: gateway compatibility
  guide, "How the connection method changes client behavior"]. `ANTHROPIC_DEFAULT_*_MODEL_SUPPORTED_CAPABILITIES`
  "have no effect behind an `ANTHROPIC_BASE_URL` gateway" [docs]. An unrecognized ID is also assumed to have a 200K
  context window [docs: Foundry page, 1M section; applies by analogy, unverified for our IDs].
- Betas, caching, thinking on 3P: in Bedrock/Vertex format Claude Code sends only "the subset ... those providers
  accept"; in Messages format (A) it sends the full set. The documented failures on a Bedrock upstream are `400
  Extra inputs are not permitted` for `context_management` and `output_config`, `Unexpected role "system"`, and
  `400` for an unknown `anthropic-beta` value; Claude Code 2.1.304+ retries without the offending field or value
  [docs: gateway compatibility guide]. 2.1.312 is past that, so the retry is expected to hide the 400s; the cost is
  one extra request per rejected capability [unverified]. `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1` removes the
  pairs up front [docs][verified name]; it is an agent-env flag, not a credential.
- Prompt caching needs `cache_control` forwarded unchanged; otherwise silent full-price input [docs]. The gateway does
  (3.2). 1-hour TTL: `ttl` in `cache_control`, no beta on Bedrock/Vertex format [docs]. Bauherr does not set
  `ENABLE_PROMPT_CACHING_1H`.
- WebSearch is not available on Bedrock [docs]; Bauherr already disallows `WebSearch`/`WebFetch` (`DISALLOWED`).

## 3. Gateway coverage (agentgateway v1.7.0)

### 3.1 Bedrock
- Messages in, Converse out: `InputFormat::Messages` to `ChatFormat::BedrockConverse` is registered; Runtime paths
  are `/model/{model}/converse` and `/converse-stream` [verified: `crates/llm/src/bedrock.rs` `get_path_for_route`,
  `crates/agentgateway/src/llm/mod.rs`]. It is a translation, not InvokeModel passthrough. A Mantle endpoint (native
  Anthropic Messages) also exists behind an endpoint preference; the Bauherr presets set none, so they use Runtime
  [verified: `renderModels` entries carry only `awsRegion`; Mantle test data in the controller].
- Streaming: `from_messages::translate_stream` plus an AWS eventstream parser (`parse/aws_sse.rs`) [verified]. Output
  to the agent is SSE in Messages shape [docs: agentgateway Bedrock page]. Smoke: [unverified].
- Tool use: tool blocks, `tool_choice` and tool results are converted (`from_messages::translate`); forced
  tool use can be rejected by the model when thinking is on [docs]. [unverified at runtime].
- `cache_control` to Bedrock `cachePoint`, with `ttl` carried [verified][docs]. Cached tokens are excluded from
  Bedrock's input count; the gateway adds them back for `llm.inputTokens` [docs].
- `anthropic-beta` is not a header upstream: the gateway copies the header values into
  `additionalModelRequestFields.anthropic_beta` [verified: `bedrock_conv.rs`, `extract_beta_headers`]. Thinking,
  `top_k`, `output_config` and request `metadata` go into the same envelope [verified]. Whether Bedrock accepts every
  beta Claude Code sends is [unverified]; `context_management` has no handling in the Converse path [verified by
  grep], so the 400-and-retry described in 2 is the likely outcome.
- Bedrock API key (`bedrock` preset, `apiKey.file`): supported by the preset renderer [verified]; the agentgateway
  page only documents `auth.aws` [docs]. Smoke: [unverified].

### 3.2 Vertex
- Anthropic models take the Messages body nearly as is: the gateway injects `anthropic_version: vertex-2023-10-16`,
  drops `output_format`, strips `cache_control.scope`, and posts to
  `/v1/projects/{p}/locations/{r}/publishers/anthropic/models/{model}:rawPredict` or `:streamRawPredict` when the
  request streams [verified: `crates/llm/src/vertex.rs`]. A model is treated as Anthropic when it carries the
  `anthropic/` or `publishers/anthropic/models/` form or matches the model catalog [verified `anthropic_model`];
  a bare `claude-sonnet-5-5@20260101` as in the preset hint needs a smoke to prove it takes the rawPredict path
  [unverified].
- `cache_control` passes (minus `scope`); `output_config` is preserved [verified]. `anthropic-beta` is not injected
  into the body here, and no header-to-body step exists in `vertex.rs` [verified by grep]; whether Vertex honors the
  header that Claude Code sends is [unverified] (the compatibility guide lists the header as the Vertex mechanism
  [docs]).
- Count-tokens path exists (`count-tokens:rawPredict`) [verified]; Bauherr does not rely on it.

### 3.3 Inbound Bedrock or Vertex format (the hybrid)
- `InputFormat` is `Completions | Messages | Responses | Embeddings | Realtime | CountTokens | Detect | Rerank |
  Decisions | SystemOne | Gemini`; there is no Bedrock InvokeModel or Converse input [verified: `crates/llm/src/lib.rs`].
  "Native Converse and Invoke requests aren't translated. They can pass through in passthrough mode for telemetry"
  [docs]. The hybrid needs `POST /model/{model}/invoke-with-response-stream` answered with the binary
  `application/vnd.amazon.eventstream` body, with the Workspace model prefix stripped from a path segment (the
  `transformation.model` CEL acts on `llmRequest.model`, not on the path) and with gateway-side SigV4 on a passthrough
  route. None of this is in the presets or tests. Hybrid is therefore unsupported; making it work would be custom
  gateway policy per provider and is [unverified] end to end.

### 3.4 Foundry
- Rendered as provider `anthropic` with `baseUrl https://<resource>.services.ai.azure.com/anthropic` [verified:
  `providers.ts`]. So Foundry is the native Messages API through the gateway, no translation. Key preset sends the key
  as the `anthropic` provider's header (`x-api-key`, see `llm/mod.rs`); Foundry accepting that header is
  [unverified]. `foundry-entra`/`-ambient` attach `auth.azure` to an `anthropic` provider entry; the combination is
  [unverified].

### 3.5 Secret references (FILE instead of inline)
- AWS: `AwsAuth::ExplicitConfig { access_key_id, secret_access_key, session_token }` are plain `SecretString` fields,
  no `FileOrInline` [verified: `http/auth/aws.rs`]. Azure: `AzureAuthCredentialSource::ClientSecret.client_secret`
  likewise [verified: `http/auth/azure.rs`]. GCP: `credential` is `FileOrInline`, which is why `vertex` can use a file
  [verified: `http/auth/gcp.rs`, `serdes.rs`]. Result: v1.7.0 has no file reference for AWS IAM or Entra client
  secrets. The gap in `docs/gateway-smoke.md` ("Credentials in config.yaml") is real.
- `ser_redact` is applied when those fields are serialized [verified: `aws.rs`, `azure.rs`]. That suggests
  `GET /api/config` on the admin port returns them redacted; `docs/gateway-smoke.md` says "not checked". Runtime
  check: [unverified].
- Implicit AWS auth (`Implicit`, optional `assumeRole`) reads the gateway process identity (env, shared credentials
  file, instance role) [verified]; it is what `bedrock-ambient` uses. It is process-wide, hence single-Workspace.

## 4. Credentials

| Preset | Secret in | Status |
|---|---|---|
| `bedrock` | 0600 file, `apiKey.file` | ok |
| `vertex` | 0600 file, `auth.gcp.credential.file` | ok |
| `foundry` | 0600 file, `apiKey.file` | ok |
| `bedrock-iam` | inline in `config.yaml` (0600) | gap: plaintext in a file that also holds config, rewritten on every `renderModels` |
| `foundry-entra` | inline in `config.yaml` (0600) | gap, same |
| `*-ambient` | none; gateway process identity | single-Workspace only (enforced) |

[verified: `providers.ts` `auth` field, `gateway.ts` `writeProvider`/`renderModels`, `docs/gateway-smoke.md`].
Storage of the secret in Bauherr: the Connection's secret is write-only in the UI and stored encrypted (`decrypt()` is
used only to render the files) [verified in `gateway.ts`; not re-audited here]. The provider file is written 0600 by
`writeProvider` (`rename` of a `.tmp`) [verified]. No file reference upstream, so the inline cases cannot be fixed in
Bauherr alone. Mitigations that need no gateway change: prefer `bedrock` (API key, file) over `bedrock-iam` in hints
and docs, grant model-invocation only, short-lived `sessionToken`.

Legal: 3P credentials (Bedrock, Vertex, Foundry) are the Workspace's own and Bauherr never intermediates Claude for
third parties (`docs/legal.md`, "Provider credential per Workspace"). Option (B) would not change that, but it would
move the credential to where an agent can read it.

## 5. Cost attribution

- 3P presets set `catalog: false`, so the Workspace budget is `Tokens` (default 20M per 30 days) and the gateway
  prices every call at USD 0 [verified: `providers.ts`, `gateway.ts` `budget`, `docs/gateway-smoke.md`].
- `runs.cost_estimate_usd` comes from the SDK: `usageOf` sums `total_cost_usd` of the results
  (`packages/runner/src/index.ts`), which is the SDK's bundled list-price table by model ID (`costBasis: "list"`,
  `runner-execution-model.md` 1) [verified]. The bundled CLI has an "unknown model" cost flag ("costs may be
  inaccurate due to usage of unknown models") [verified string]. For `us.anthropic...-v1:0`, `claude-...@date` or a
  Foundry deployment name the estimate may be 0 or a fallback; which one is [unverified].
- `reconcileRun` (`apps/server/src/lib/reconcile.ts`) writes the gateway sum into `gatewayCostUsd` and sets
  `costSource: 'gateway'` whenever `request_logs` rows exist. With a priced-at-0 gateway that sum is 0, and the
  field `costUsd` (`gatewayCostUsd ?? costEstimateUsd`, `collections.ts`) shows 0 because 0 is not nullish [verified].
  The `mismatch` check is `|gateway - estimate| <= 10 % of gateway`, so with gateway 0 any non-zero estimate is a
  `mismatch` [verified: code]. Net effect for 3P Runs: USD cost shown as 0, tokens correct (`gatewayTokens*` come from
  `request_logs`), reconcile status noisy.
- `maxBudgetUsd` (SDK client-side cap) depends on the same estimate; if it is 0 for 3P IDs the cap never trips and
  only the gateway token budget and `maxTurns` stop a Run [unverified].
- Catalogs: `modelCatalog` is keyed by gateway provider name: `anthropic`, `aws.bedrock`, `gcp.vertex_ai`
  [verified: `bedrock.rs`, `vertex.rs`]. Foundry entries use provider `anthropic`, so the existing `anthropic.json`
  would price a Foundry call whose model name equals a catalog key (`claude-sonnet-5-5`); the preset keeps
  `catalog: false` only by flag [verified]. Whether Foundry list prices equal Anthropic's and whether a deployment
  name equals the key is [unverified]. Bedrock/Vertex need their own provider sections; rates support `contextOver`
  and `serviceTier` tiers [verified: `catalog/model.rs`], so `flex`/`priority` tiers are expressible; regional
  surcharges (`us.` vs `global.` profiles), application inference profile ARNs and provisioned throughput (billed by
  commitment, ARN as model ID) are not [docs: Bedrock page; verified: no region field in `Tier`].
  The agentgateway repo also ships a catalog generator for Bedrock and Vertex pricing
  (`controller/pkg/cli/catalog/source_bedrock.go`, `source_vertex.go`) [verified exists; not run].
- Recommendation: do not ship Bedrock or Vertex catalogs now. A catalog with `catalog: true` and an ID that is not in
  it prices at 0 while the budget stays USD, so the budget never trips (`docs/gateway-smoke.md`): a silent failure
  worse than the token budget. Foundry may reuse `anthropic.json` once a smoke shows matching names.

## 6. Recommendation

1. Keep (A). It alone keeps the three guarantees: budgets, `request_logs`, no cloud credential in the agent env.
   Nothing in the SDK needs `CLAUDE_CODE_USE_*`: the Messages path works with an unrecognized model ID.
2. Do not build (B). Allow it, at most, as a later explicit opt-in for self-hosted single-tenant installs, where the
   operator and the agent share a trust domain and accept losing budgets and logs; that needs its own ticket and
   threat model. Hybrid is not supported by v1.7.0 (3.3).
3. Document and fix the gaps: inline `bedrock-iam`/`foundry-entra` secrets (upstream limitation), no 3P price
   catalogs, USD 0 and `mismatch` for 3P Runs, and all runtime behavior (3.x) unproven until the owner signs off on
   credentials for a smoke.

## 7. Build ticket (draft, not filed)

**Title:** Smoke Bedrock, Vertex and Foundry through the gateway; fix 3P cost display and pin the no-credential invariant

**Goal**
- Each 3P preset is smoke-tested through the gateway (1-token call and a tool-use call, streaming, `cache_control`,
  `anthropic-beta`), and the results are in `docs/gateway-smoke.md`.
- A 3P Run shows a truthful cost state: tokens, and USD "not priced" instead of 0 or `mismatch`.
- Raw cloud credentials never enter `agentEnv`; a test pins it.

**Out of scope:** SDK-native mode (B), the hybrid, 3P price catalogs for Bedrock/Vertex, session mode (#63).

**Steps**
1. Owner-gated smoke (needs the owner's credentials; the Run stops `needs_human` until they exist). Per preset
   (`bedrock`, `bedrock-iam`, `vertex`, `foundry`, `foundry-entra`; ambient only on a single-Workspace instance):
   Connection save (the built-in 1-token verify), a Run with a tool call, a second turn to see cache tokens in
   `request_logs`, a streamed call. Record per preset in `docs/gateway-smoke.md` under Providers: works / 400 with the
   rejected field. Open questions to answer: Vertex bare model ID takes the rawPredict path; Vertex honors
   `anthropic-beta`; Bedrock accepts the beta set or Claude Code's retry hides it; Foundry accepts `x-api-key` and
   `auth.azure` on an `anthropic` entry; Bedrock API key via `apiKey.file`; `GET /api/config` redacts inline secrets.
2. Only if step 1 shows 400 loops on Bedrock/Vertex: add `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1'` to `agentEnv`
   for those presets, via a `Def.agentEnv?: Record<string,string>` flags field (flags only, never secrets) and
   `provider` on `RunCtx.connection`. If step 1 is clean, skip this step.
3. Cost: for `catalog:false` presets, do not write `gatewayCostUsd`/`costSource: 'gateway'` from `reconcileRun` when the
   gateway cost sum is 0 and tokens are non-zero; keep `costSource: 'sdk-estimate'` and mark reconcile
   `unpriced` (new value, no `mismatch`). Show tokens and "unpriced" in the Run UI where USD is shown.
4. Foundry: if step 1 confirms name and price parity, set `catalog: true` on `foundry`, `foundry-entra`,
   `foundry-ambient` (reuses `anthropic.json`); otherwise leave as is and document why.
5. Credentials: in `docs/gateway-smoke.md` and the preset hints, state that `bedrock-iam`/`foundry-entra` are inline
   because v1.7.0 has no file reference, and recommend `bedrock` (API key file) first; if step 1 shows `GET
   /api/config` returns inline secrets in clear, escalate (admin port is never published, `config.yaml.tmpl`).

**Files:** `docs/gateway-smoke.md`, `apps/server/src/lib/reconcile.ts`, `apps/server/src/lib/providers.ts`,
`apps/server/src/collections.ts` (reconcile status option), the Run UI component that renders cost, and only if
step 2 applies `packages/runner/src/agent.ts`, `packages/runner/src/types.ts`.

**Tests**
- `packages/runner/test/units.test.ts`: the existing `agent env carries no gateway key and no process env` stays green
  and unchanged. New, table-driven over every `PRESETS` key: `buildOptions(...).env` has exactly the expected keys and no
  key matching `/^(AWS_|GOOGLE_|AZURE_|ARM_|ANTHROPIC_(BEDROCK|VERTEX|FOUNDRY)_|CLAUDE_CODE_USE_|CLAUDE_CODE_SKIP_)/`,
  with `process.env` seeded with `AWS_SECRET_ACCESS_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`, `ANTHROPIC_FOUNDRY_API_KEY`
  to prove nothing leaks. Invariant: raw cloud credentials never enter `agentEnv`. If step 2 applies, assert the extra
  flag is the only added key.
- `apps/server/tests/gateway-config.test.ts`: per `auth: 'inline'` preset the secret appears only in `config.yaml`
  (0600), never in `providers/`; per `auth: 'file'` preset it appears in no `config.yaml` text.
- `reconcile` test: gateway cost 0 with non-zero tokens gives `unpriced`, not `mismatch`, and `costUsd` stays the
  estimate.
- `pnpm --filter server test:gateway` (`--validate-only`) and `pnpm test` in `apps/server` stay green.

## 8. Sources

- Claude Code on Amazon Bedrock: https://code.claude.com/docs/en/amazon-bedrock
- Claude Code on Google Cloud's Agent Platform (Vertex): https://code.claude.com/docs/en/google-vertex-ai
- Claude Code on Microsoft Foundry: https://code.claude.com/docs/en/microsoft-foundry
- LLM gateway overview and compatibility guide: https://code.claude.com/docs/en/llm-gateway and
  https://code.claude.com/docs/en/llm-gateway-protocol.md
- agentgateway Bedrock and Vertex provider docs: https://agentgateway.dev/docs/standalone/latest/llm/providers/bedrock/ and
  https://agentgateway.dev/docs/standalone/latest/llm/providers/vertex/
- agentgateway v1.7.0 source (tag `v1.7.0`): `crates/llm/src/{bedrock,vertex,lib}.rs`,
  `crates/llm/src/conversion/{bedrock,vertex}.rs`, `crates/agentgateway/src/llm/{mod.rs,catalog/}`,
  `crates/agentgateway/src/http/auth/{aws,azure,gcp}.rs`, `controller/pkg/cli/catalog/`
- Installed `@anthropic-ai/claude-agent-sdk` 0.3.312: `sdk.d.ts`, `sdk.mjs`, bundled `claude` binary strings
- Repo: `packages/runner/src/{agent,proxy,index}.ts`, `packages/runner/test/units.test.ts`,
  `apps/server/src/lib/{providers,gateway,reconcile}.ts`, `deploy/gateway/`, `docs/legal.md`, `docs/gateway-smoke.md`

## 9. Not verified (needs credentials and a smoke)

Every runtime behavior against AWS, GCP and Azure: streaming, tool use and cache tokens through Converse and
rawPredict; which betas each provider rejects; Vertex bare model ID routing; Vertex `anthropic-beta` handling; Foundry
`x-api-key` and Entra on an `anthropic` entry; Bedrock API key via `apiKey.file`; admin `GET /api/config` redaction;
SDK `total_cost_usd` and `maxBudgetUsd` for 3P model IDs; 200K-window assumption for unrecognized IDs; Foundry
price parity with `anthropic.json`.
