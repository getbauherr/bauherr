# Observability

Opt-in compose profile `observability`: Prometheus scrapes the gateway's metrics, Jaeger 2 receives its traces. Both are Apache-2.0.

```bash
OTEL_ENABLED=1 docker compose --profile observability up -d
```

`OTEL_ENABLED=1` makes `init` render the gateway's `tracing.otlpEndpoint` (`http://jaeger:4317`) the first time it writes `/gateway/config.yaml`; set it before the first start, or delete that file's volume. Without `--profile observability` nothing receives the traces, and `init` prints a reminder.

| What | Where |
|---|---|
| Prometheus UI | `http://127.0.0.1:9090`, target `agentgateway` (`gateway:15020/metrics`, every 15 s), config in [`deploy/prometheus/prometheus.yml`](../deploy/prometheus/prometheus.yml) |
| Jaeger UI | `http://127.0.0.1:16686`, config in [`deploy/jaeger/config.yaml`](../deploy/jaeger/config.yaml) |

- Prometheus keeps 30 days in the `bauherr-prometheus` volume.
- Jaeger stores traces in memory only: the newest 50 000 (`max_traces` in its config), older ones are evicted, a restart clears them.
- Only the two UIs are published, and only on `127.0.0.1`. OTLP (4317 gRPC, 4318 HTTP) is reachable inside the compose network only.

Grafana and Loki (AGPL) are not included; they may come later as a separate optional profile.
