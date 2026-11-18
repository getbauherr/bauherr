# Observability

The opt-in compose profile `observability` runs Prometheus, which scrapes the gateway's metrics, and Jaeger 2, which receives its traces. Both are Apache-2.0.

```bash
OTEL_ENABLED=1 docker compose --profile observability up -d
```

`OTEL_ENABLED=1` makes `init` render the gateway's `frontendPolicies.tracing` the first time it writes `/gateway/config.yaml`. It sets `host: jaeger:4317` and `randomSampling: true`. agentgateway v1.7.0 samples requests without a trace context only with this, so Jaeger stays empty without it.

Set it before the first start, or delete that file's volume. Without `--profile observability` nothing receives the traces, and `init` prints a reminder.

| What | Where |
|---|---|
| Prometheus UI | `http://127.0.0.1:9090`, target `agentgateway` at `gateway:15020/metrics` every 15 s, config [`deploy/prometheus/prometheus.yml`](https://github.com/getbauherr/bauherr/blob/main/deploy/prometheus/prometheus.yml) |
| Jaeger UI | `http://127.0.0.1:16686/-/traces`, config [`deploy/jaeger/config.yaml`](https://github.com/getbauherr/bauherr/blob/main/deploy/jaeger/config.yaml) |

- Prometheus keeps 30 days in the `bauherr-prometheus` volume.
- Jaeger keeps traces in memory only. It holds the newest 50 000, set by `max_traces`, and a restart clears them.
- Only the two UIs are published, on `127.0.0.1`. OTLP on 4317 gRPC and 4318 HTTP is reachable inside the compose network only.

## In the app

Settings → AI usage shows the budget, providers, tiers and costs per Product, Ticket and stage to every Workspace member. The data comes from `runs` for the last 30 days. Admins also get two links.

- **Open traces** opens the traces UI address saved under Monitoring. Without one it opens Jaeger at `JAEGER_PUBLIC_URL`, default `http://127.0.0.1:16686/-/traces/`. It is greyed out while the profile is off, judged by a HEAD probe of `JAEGER_URL` (default `http://jaeger:16686`, cached 60 s). It is not proxied: the sandbox below stops the Jaeger UI from loading its assets, see #469.
- **Open gateway config** goes to `/-/gateway/config_dump`. It proxies the gateway admin API at `GATEWAY_ADMIN_URL`, read-only. Writes pass only with `GATEWAY_ADMIN_PROXY_WRITE=1`, and each is recorded in `human_touches`.

The gateway console `/ui` does not work behind that prefix, because it requests `/ui/assets/…` and `/api/…` from the site root. The admin port 15000 is not published on the host.

The proxy route is Admin-only and answers 404 to everyone else. It never forwards cookies or `Authorization`. Every answer carries `Content-Security-Policy: sandbox allow-scripts allow-forms` and `nosniff`, so an upstream page runs as an opaque origin and cannot use the Admin's session.

## Use your own monitoring stack

Settings → Connections → Monitoring connects the gateway to monitoring you already run. The `observability` profile then becomes optional. Only Admins see it; everyone else gets 404 or a refusal.

Monitoring covers the whole instance. There is at most one entry per service, and entries are not listed with a Workspace's Connections.

Credentials are stored encrypted in `connections.secret`. They are never shown again after saving, and never reach the browser or the logs. To change one, enter a new value or choose "Remove the saved …".

| Entry | You give | What it does |
|---|---|---|
| Traces (OTLP) | `host:port` of an OTLP receiver, protocol `grpc` (usually 4317) or `http` (usually 4318), optional auth header, optional traces UI address | Writes `frontendPolicies.tracing` into `/gateway/config.yaml` with mode 0600 and `randomSampling: true`. The gateway hot-reloads it. "Open traces" then opens the saved UI address. Removing the entry restores the bundled behaviour: Jaeger with `OTEL_ENABLED=1`, otherwise no tracing. |
| Prometheus | Its address, optional API token for Test connection | Offers `GET /-/metrics`, the gateway metrics from `GATEWAY_METRICS_URL` (default `http://gateway:15020/metrics`), for your Prometheus to scrape. |
| Grafana | Its address, optional service-account token | "Open dashboards" on Settings → AI usage and Health. The token is only checked, not used otherwise. |

The Prometheus scrape token is minted on saving and shown once with a `scrape_configs` snippet: job `bauherr`, bearer `authorization`, `metrics_path: /-/metrics`. Only its SHA-256 hash is stored. "New scrape token" replaces it and the old one stops at once.

### Test connection

Each entry has "Test connection". It has a 5 s limit and follows no redirects, so a request never leaves the host you typed. No credential appears in the result.

- Traces opens a TCP connection to `host:port` and reports "Reachable" or "Cannot reach …". It sends no trace.
- Prometheus asks `/api/v1/query?query=up{job="bauherr"}` and reports whether Bauherr's target is up, has not scraped yet, or is down. The API token goes as bearer.
- Grafana asks `/api/health`, and with a token `/api/user`.

The outcome is stored as `verifiedAt` or `lastError` and shown as Verified or Failed. Saving clears it.

### Limits

- Auth header: agentgateway v1.7.0 sends headers to the OTLP target through the tracing policy's `policies.requestHeaderModifier`, for gRPC and HTTP. See its [config schema](https://github.com/agentgateway/agentgateway/blob/v1.7.0/schema/config.json) and [`trc.rs`](https://github.com/agentgateway/agentgateway/blob/v1.7.0/crates/agentgateway/src/telemetry/trc.rs). The value is written in plain text into `config.yaml` with mode 0600 and nowhere else.
- No TLS option: the gateway talks plain to `host:port`. For a collector that needs TLS or more than a static header, put an OpenTelemetry Collector next to the gateway and forward with your credentials.
- `/-/metrics` answers 401 without the token, with a wrong one, or without a Prometheus entry. It answers 502 while the gateway is down. It serves only the gateway's metrics text.
- Put TLS in front of Bauherr: the token is a bearer credential. The snippet's target is the address you opened Settings on. Change it if Prometheus reaches Bauherr elsewhere.
- Bauherr does not push metrics. Prometheus pulls.

Grafana and Loki are AGPL and not in the bundled profile.
