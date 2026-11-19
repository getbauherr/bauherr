# Observability profile and gateway UI

Cut from the lean core on 2026-11-19. The code is at the git tag `legacy-final`.

## What it did

- Compose profile `observability` ran Prometheus v3.16.0 (scrapes the gateway at `gateway:15020/metrics` every 15 s, keeps 30 days in volume `bauherr-prometheus`, UI on `127.0.0.1:9090`) and Jaeger 2.23.0 (traces in memory, newest 50 000, UI on `127.0.0.1:16686`). OTLP 4317 and 4318 stayed inside the compose network.
- `OTEL_ENABLED=1` made `init` write the gateway's `frontendPolicies.tracing` (`host: jaeger:4317`, `randomSampling: true`) the first time it created `/gateway/config.yaml`. Without it Jaeger stays empty.
- Settings > Connections > Monitoring (Admin only, one entry per service, instance-wide) connected the gateway to the operator's own stack: Traces (OTLP, grpc or http, optional auth header), Prometheus (a scrape token, shown once, stored as SHA-256 hash, endpoint `GET /-/metrics`) and Grafana (links only). Each had "Test connection" (5 s, no redirects) with `verifiedAt` or `lastError`.
- Settings > AI usage showed budget and cost per Product, Ticket and stage from `runs` (last 30 days). Admins also got "Open traces" and "Open gateway config", an Admin-only, read-only proxy of the gateway admin API (`/-/gateway/config_dump`). Writes only with `GATEWAY_ADMIN_PROXY_WRITE=1`, each recorded in `human_touches`. Proxied answers carried `Content-Security-Policy: sandbox allow-scripts allow-forms` and never forwarded cookies or `Authorization`.
- Profile `gateway-ui` ran a pinned `alpine/socat` that forwarded the gateway admin port 15000 to `127.0.0.1:${GATEWAY_UI_PORT:-15000}`. It was off by default because port 15000 has no sign-in and can change gateway keys. `GATEWAY_UI_URL` made "Open the gateway UI" a working link.

## The requirement behind it

- See what the gateway did (requests, latency, cost) without building a stack first (#54, #55, #458, #461).
- Let an operator with an existing Prometheus, Grafana or OTLP collector plug in instead (#571, #572).
- Let an Admin look at the gateway's own console safely (#469, #475).

## Where the code is

- `compose.yaml`: services `prometheus`, `jaeger`, `gateway-ui`, volume `bauherr-prometheus`. `deploy/prometheus/prometheus.yml` (7 lines), `deploy/jaeger/config.yaml` (41).
- `apps/server/src/lib/monitoring.ts` (193): `monitoringErrors`, `tracingPolicy`, `renderTracing`, `mintScrapeToken`, `scrapeSnippet`, `scrapeTokenValid`, `testMonitoring`, `loadMonitoring`.
- `apps/server/src/app/-/metrics/route.ts` (21); `apps/server/src/app/(app)/lib/admin-proxy.ts` (84); `apps/server/src/app/(app)/lib/gateway-setup.ts` (`UI_SWITCH_ON`, `uiUrl`); `apps/server/src/app/(app)/components/gateway/GatewayStatus.tsx`.
- Settings pages: `apps/server/src/app/(app)/(shell)/settings/connections/page.tsx`, `.../settings/usage/page.tsx`, `.../settings/health/page.tsx`. Migration `apps/server/src/migrations/20261113_100000_monitoring_connections.ts`.
- Tests: `apps/server/tests/monitoring.test.ts` (301), `monitoring-actions.test.ts` (60), `admin-proxy.test.ts` (122); `apps/server/e2e/monitoring.spec.ts` (90).
- Docs: `docs/observability.md` (67), `docs/gateway.md` (136, section "The gateway UI").

## Why it was cut

They are optional infrastructure outside the core loop. The bundled gateway itself and its per-Workspace key and budget stay.

## What a module on the new core needs

- Contracts: none on the record or lifecycle. A module here is compose files plus a settings page; it never reads or writes tickets.
- Lift almost unchanged: the compose services and `deploy/` configs, `tracingPolicy`, `renderTracing`, `mintScrapeToken`/`scrapeTokenValid`, `testMonitoring`, `admin-proxy.ts` and its CSP rules, `docs/observability.md`.
- Design again: whether monitoring entries stay `connections` rows or become plain settings; how usage by role and ticket is read from the mirror, not from `runs`.
- Traps: tracing is written only when `/gateway/config.yaml` is first created, so set `OTEL_ENABLED` before first start or delete the volume. The auth header is written in plain text to a 0600 file. No TLS option for OTLP. The gateway console `/ui` does not work behind a URL prefix, so it is not proxied. Port 15000 has no sign-in, so bind to loopback only. Jaeger loses its traces on restart.
