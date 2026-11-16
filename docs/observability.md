# Observability

Opt-in compose profile `observability`: Prometheus scrapes the gateway's metrics, Jaeger 2 receives its traces. Both are Apache-2.0.

```bash
OTEL_ENABLED=1 docker compose --profile observability up -d
```

`OTEL_ENABLED=1` makes `init` render the gateway's `frontendPolicies.tracing` (`host: jaeger:4317`, `randomSampling: true`: agentgateway v1.7.0 samples a request without an incoming trace context only when this is set, so without it Jaeger stays empty) the first time it writes `/gateway/config.yaml`; set it before the first start, or delete that file's volume. Without `--profile observability` nothing receives the traces, and `init` prints a reminder.

| What | Where |
|---|---|
| Prometheus UI | `http://127.0.0.1:9090`, target `agentgateway` (`gateway:15020/metrics`, every 15 s), config in [`deploy/prometheus/prometheus.yml`](https://github.com/getbauherr/bauherr/blob/main/deploy/prometheus/prometheus.yml) |
| Jaeger UI | `http://127.0.0.1:16686/-/traces` (base path `/-/traces`), config in [`deploy/jaeger/config.yaml`](https://github.com/getbauherr/bauherr/blob/main/deploy/jaeger/config.yaml) |

- Prometheus keeps 30 days in the `bauherr-prometheus` volume.
- Jaeger stores traces in memory only: the newest 50 000 (`max_traces` in its config), older ones are evicted, a restart clears them.
- Only the two UIs are published, and only on `127.0.0.1`. OTLP (4317 gRPC, 4318 HTTP) is reachable inside the compose network only.

## In the app (Admins)

Settings → AI usage shows the budget, providers, tiers and costs per Product, Ticket and stage (from `runs`, last 30 days) to every member of the Workspace. Admins also get two links, the gateway one served by an Admin-only route handler that answers 404 to everyone else, never forwards cookies or `Authorization`, and sends every answer with `Content-Security-Policy: sandbox allow-scripts allow-forms` and `nosniff`, so an upstream page runs as an opaque origin and cannot act with the Admin's session:

- **Open traces** → the traces UI address saved under Monitoring (enabled whenever one is saved), otherwise Jaeger on its own loopback origin, `JAEGER_PUBLIC_URL` (default `http://127.0.0.1:16686/-/traces/`); greyed out while the `observability` profile is off (server-side HEAD probe of `JAEGER_URL`, default `http://jaeger:16686`, cached 60 s). It is not proxied: under the sandbox below the Jaeger UI cannot load its assets (checked live, #469).
- **Open gateway config** → `/-/gateway/config_dump` proxies the gateway admin API (`GATEWAY_ADMIN_URL`) for raw read-only endpoints; only GET/HEAD pass unless `GATEWAY_ADMIN_PROXY_WRITE=1`, and every passed write is recorded in `human_touches`. The agentgateway console (`/ui`) does not work behind this prefix: it loads `/ui/assets/…` and calls `/api/…` from the site root, which hit Bauherr's own `/api`. The admin port 15000 is not published on the host.

## Use your own monitoring stack

Settings → Connections → Monitoring (Admins only, the routes and actions answer everyone else with 404 or a refusal) connects the gateway to monitoring you already run, so the `observability` profile becomes optional. Monitoring covers the whole instance, not one Workspace: there is at most one entry per service, and the entries are not listed with a Workspace's own Connections. Credentials are stored encrypted (`connections.secret`), are never shown again after saving (the form shows "saved" and, to change it, accepts a new value or "Remove the saved ..."), and never reach the browser or the logs.

| Entry | You give | What it does |
|---|---|---|
| Traces (OTLP) | `host:port` of an OTLP receiver, protocol `grpc` (usually 4317) or `http` (usually 4318), an optional auth header (name and value), an optional traces UI address | Writes the gateway's `frontendPolicies.tracing` into `/gateway/config.yaml` (0600) with `randomSampling: true`; the gateway hot-reloads it, no restart. "Open traces" on Settings → AI usage then opens the saved UI address. Removing the entry puts the bundled behaviour back (`OTEL_ENABLED=1`: Jaeger, otherwise no tracing). |
| Grafana | its address, an optional service-account token | "Open dashboards" on Settings → AI usage and Health. The token is only used to check that Grafana accepts it. |

Each entry has "Test connection" (5 s limit, redirects are not followed, so a request never leaves the host you typed; no credential appears in the result): Traces opens a TCP connection to `host:port` ("Reachable" or "Cannot reach host:port (connection refused / timed out / host not found)"; it does not send a trace); Grafana asks `/api/health` ("Grafana answered (version x)") and, with a token, `/api/user` ("Token accepted"). The outcome is stored (`verifiedAt` or `lastError`) and shown as Verified or Failed. Saving clears it.

- Auth header: agentgateway v1.7.0 sends headers to the OTLP target through the tracing policy's `policies.requestHeaderModifier` (checked in its [config schema](https://github.com/agentgateway/agentgateway/blob/v1.7.0/schema/config.json) and [`trc.rs`](https://github.com/agentgateway/agentgateway/blob/v1.7.0/crates/agentgateway/src/telemetry/trc.rs), for gRPC and HTTP). The header value is written in plain text into `config.yaml` (0600, like the inline provider secrets), never anywhere else.
- No TLS option: the gateway talks plain to `host:port`. For a collector that needs TLS, or one that wants something other than a static header, put a collector in front of it (an OpenTelemetry Collector next to the gateway that forwards with your credentials).
- A prometheus entry is not offered yet (it is refused by validation); the scrape endpoint comes with the next change.

Grafana and Loki (AGPL) are not included in the bundled profile; they may come later as a separate optional profile.
