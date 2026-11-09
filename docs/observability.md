# Observability

Opt-in compose profile `observability`: Prometheus scrapes the gateway's metrics, Jaeger 2 receives its traces. Both are Apache-2.0.

```bash
OTEL_ENABLED=1 docker compose --profile observability up -d
```

`OTEL_ENABLED=1` makes `init` render the gateway's `frontendPolicies.tracing` (`host: jaeger:4317`, `randomSampling: true`: agentgateway v1.7.0 samples a request without an incoming trace context only when this is set, so without it Jaeger stays empty) the first time it writes `/gateway/config.yaml`; set it before the first start, or delete that file's volume. Without `--profile observability` nothing receives the traces, and `init` prints a reminder.

| What | Where |
|---|---|
| Prometheus UI | `http://127.0.0.1:9090`, target `agentgateway` (`gateway:15020/metrics`, every 15 s), config in [`deploy/prometheus/prometheus.yml`](../deploy/prometheus/prometheus.yml) |
| Jaeger UI | `http://127.0.0.1:16686/-/traces` (base path `/-/traces`), config in [`deploy/jaeger/config.yaml`](../deploy/jaeger/config.yaml) |

- Prometheus keeps 30 days in the `bauherr-prometheus` volume.
- Jaeger stores traces in memory only: the newest 50 000 (`max_traces` in its config), older ones are evicted, a restart clears them.
- Only the two UIs are published, and only on `127.0.0.1`. OTLP (4317 gRPC, 4318 HTTP) is reachable inside the compose network only.

## In the app (Admins)

Settings → AI usage shows the budget, providers, tiers and costs per Product, Ticket and stage (from `runs`, last 30 days) to every member of the Workspace. Admins also get two links, served by Admin-only route handlers that answer 404 to everyone else and never forward cookies or `Authorization`:

- **Open traces** → `/-/traces/` proxies Jaeger (`JAEGER_URL`, default `http://jaeger:16686`), read-only; greyed out while the `observability` profile is off (HEAD probe, cached 60 s).
- **Open gateway config** → `/-/gateway/config_dump` proxies the gateway admin API (`GATEWAY_ADMIN_URL`) for raw read-only endpoints; only GET/HEAD pass unless `GATEWAY_ADMIN_PROXY_WRITE=1`, and every passed write is recorded in `human_touches`. The agentgateway console (`/ui`) does not work behind this prefix: it loads `/ui/assets/…` and calls `/api/…` from the site root, which hit Bauherr's own `/api`. The admin port 15000 is not published on the host.

Grafana and Loki (AGPL) are not included; they may come later as a separate optional profile.
