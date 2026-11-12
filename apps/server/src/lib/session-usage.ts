import pg from 'pg'
import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { modelName, priceOf } from './cost'
import { repriceUnpriced, setState } from './prices'

/** One logged gateway call of the session key, reduced to what attribution needs. `session` is the `x-bauherr-session` header (null: the key alone). */
export type Call = { at: number; workspace: number; session: string | null; role: string | null; model: string; provider: string; tin: number; tout: number; cr: number; cw: number; cost: number | null }
export type Sess = { id: number; workspace: number; clientKey: string; role: string; connectedAt: number; disconnectedAt: number | null }
export type Span = { sessionId: number; runId: number; ticketId: number | null; stage: string | null; role: string | null; startedAt: number; lastAt: number }
export type Hit = { call: Call; session: Sess | null; span: Span | null }

/**
 * Who a call belongs to. The key decides the Workspace (`call.workspace`); the header only picks a session inside it, so no header value reaches another Workspace.
 * Several sessions of the Workspace can use the same name (two people): the one holding a Run at that time wins, else the one connected then, else the latest connected.
 * The Run is the span of that session covering the call; a call between Runs belongs to the session without a Run.
 */
export const attribute = (calls: Call[], sessions: Sess[], spans: Span[]): Hit[] =>
  calls.map((call) => {
    const named = call.session ? sessions.filter((s) => s.workspace === call.workspace && s.clientKey === call.session) : []
    const cover = (s: Sess) => spans.filter((p) => p.sessionId === s.id && p.startedAt <= call.at && call.at <= p.lastAt).sort((a, b) => b.startedAt - a.startedAt)[0]
    const live = named.filter((s) => s.connectedAt <= call.at && (s.disconnectedAt == null || call.at <= s.disconnectedAt))
    const byConnect = (a: Sess, b: Sess) => b.connectedAt - a.connectedAt
    const session = named.find((s) => cover(s)) ?? [...live].sort(byConnect)[0] ?? [...named].sort(byConnect)[0] ?? null
    return { call, session, span: session ? cover(session) ?? null : null }
  })

type Group = { workspace: number; session: Sess | null; span: Span | null; day: string | null; model: string; provider: string; role: string | null; at: number; tin: number; tout: number; cr: number; cw: number; costs: (number | null)[] }

/** Sums hits per (Workspace, Run or session-without-Run, model); Run-less groups are cut per UTC day so a recompute of the last days never rewrites older ones. */
export const group = (hits: Hit[]): Group[] => {
  const m = new Map<string, Group>()
  for (const { call: c, session, span } of hits) {
    const day = span ? null : new Date(c.at).toISOString().slice(0, 10)
    const key = [c.workspace, span?.runId ?? '', session?.id ?? '', day ?? '', c.model, c.provider, session ? '' : c.role ?? ''].join('|')
    const g = m.get(key) ?? { workspace: c.workspace, session, span, day, model: c.model, provider: c.provider, role: c.role, at: c.at, tin: 0, tout: 0, cr: 0, cw: 0, costs: [] }
    g.tin += c.tin
    g.tout += c.tout
    g.cr += c.cr
    g.cw += c.cw
    g.at = Math.min(g.at, c.at)
    g.costs.push(c.cost)
    m.set(key, g)
  }
  return [...m.values()]
}

/** The gateway's own cost, else the catalog's list price for the call (null: the model is unknown to both). A group with any unpriced call stays unpriced and is priced later, whole, by `repriceUnpriced`. */
const costOf = (g: Group): number | null => (g.costs.some((c) => c == null) ? null : g.costs.reduce<number>((a, c) => a + (c ?? 0), 0))

/** The Connection slug of `ws-<slug>/<connection>/<model>`; the owner's own login (no prefix or `sub/`) is `subscription`. */
export const providerOf = (original: string | null | undefined): string => {
  const parts = (original ?? '').split('/')
  return parts[0]?.startsWith('ws-') && parts.length > 2 ? parts[1]! : 'subscription'
}

const LOOKBACK_DAYS = 2
/** A Run stuck in `running` must not make the job scan the whole request log every minute. */
export const MAX_SCAN_DAYS = 14
const dayStart = (ms: number) => Date.UTC(new Date(ms).getUTCFullYear(), new Date(ms).getUTCMonth(), new Date(ms).getUTCDate())

/**
 * Attributes the session key's calls of the last two UTC days (and of any Run that was open then) to sessions and Runs and rewrites their gateway `usage_entries`.
 * Idempotent: Run rows are upserted by (Run, model), Run-less rows of the window are replaced in one transaction, so a rerun, a late log row or a restart never double counts.
 * A Run that is still running holds its span open until now (the model call that decides the next heartbeat starts after the last one).
 * Calls of failed requests (no tokens) are ignored. A call without `x-bauherr-run` that arrived through a Workspace's session key or carries a session header is session traffic; Runner calls carry `x-bauherr-run` and stay with `reconcile-costs`.
 */
export const reconcileSessions = async (payload: Payload, now = Date.now()): Promise<{ calls: number; runs: number }> => {
  const cutoff = dayStart(now - (LOOKBACK_DAYS - 1) * 864e5)
  const db = payload.db.drizzle
  const spanRows = (await db.execute(sql`SELECT p."session_id", p."run_id", p."ticket_id", r."stage", r."role", r."status", p."started_at", p."last_at" FROM "session_spans" p JOIN "runs" r ON r."id" = p."run_id" WHERE p."last_at" >= ${new Date(cutoff).toISOString()}::timestamptz OR r."status" = 'running'`)).rows as Record<string, any>[]
  const spans: Span[] = spanRows.map((r) => ({ sessionId: r.session_id, runId: r.run_id, ticketId: r.ticket_id, stage: r.stage, role: r.role, startedAt: new Date(r.started_at).getTime(), lastAt: r.status === 'running' ? now : new Date(r.last_at).getTime() }))
  const from = Math.max(now - MAX_SCAN_DAYS * 864e5, Math.min(cutoff, ...spans.map((s) => s.startedAt)))
  const wsRows = (await db.execute(sql`SELECT "id", "slug" FROM "workspaces"`)).rows as { id: number; slug: string }[]
  const bySlug = new Map(wsRows.map((w) => [w.slug, w.id]))
  const client = new pg.Client({ connectionString: process.env.GATEWAY_DATABASE_URL })
  await client.connect()
  let rows: Record<string, any>[]
  try {
    rows = (
      await client.query(
        `SELECT started_at, agentgateway_user AS ws_user, attributes_json->>'session' AS session, attributes_json->>'role' AS role, attributes_json->>'agw.ai.original_model' AS original,
                gen_ai_request_model AS model, COALESCE(input_tokens, 0) AS tin, COALESCE(output_tokens, 0) AS tout, COALESCE(cache_read_input_tokens, 0) AS cr, COALESCE(cache_creation_input_tokens, 0) AS cw, cost
         FROM request_logs
         WHERE started_at >= $1 AND attributes_json->>'run' IS NULL AND (attributes_json->>'session' IS NOT NULL OR attributes_json->>'agw.api_key.name' LIKE '%-session')
           AND COALESCE(http_status, 200) < 400 AND COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0) > 0
         ORDER BY started_at`,
        [new Date(from).toISOString()],
      )
    ).rows
  } finally {
    await client.end()
  }
  const calls: Call[] = rows.flatMap((r) => {
    const workspace = bySlug.get(String(r.ws_user ?? '').replace(/^workspace-/, ''))
    if (!workspace) return []
    const tin = Math.max(0, Number(r.tin) - Number(r.cr) - Number(r.cw))
    const base = { tin, tout: Number(r.tout), cr: Number(r.cr), cw: Number(r.cw) }
    const model = modelName(r.model)
    const gateway = r.cost == null || Number(r.cost) <= 0 ? null : Number(r.cost)
    return [{ at: new Date(r.started_at).getTime(), workspace, session: typeof r.session === 'string' && r.session ? r.session.slice(0, 64) : null, role: r.role ?? null, model, provider: providerOf(r.original), ...base, cost: gateway ?? priceOf(model, { tokensIn: base.tin, tokensOut: base.tout, cacheRead: base.cr, cacheWrite: base.cw }) }]
  })
  const sessRows = (await db.execute(sql`SELECT "id", "workspace_id", "client_key", "role", "connected_at", "disconnected_at" FROM "agent_sessions" WHERE "client_key" IS NOT NULL`)).rows as Record<string, any>[]
  const sessions: Sess[] = sessRows.map((s) => ({ id: s.id, workspace: s.workspace_id, clientKey: s.client_key, role: s.role, connectedAt: new Date(s.connected_at).getTime(), disconnectedAt: s.disconnected_at ? new Date(s.disconnected_at).getTime() : null }))
  const groups = group(attribute(calls, sessions, spans)).filter((g) => g.span || g.at >= cutoff)
  const runIds = new Set<number>()
  const spanRuns = [...new Set(spans.map((p) => p.runId))]
  const keep = [...new Set(groups.filter((g) => g.span).map((g) => `${g.span!.runId}|${g.model}`))].map((k) => k.split('|') as [string, string])
  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM "usage_entries" WHERE "source" = 'gateway' AND "run_id" IS NULL AND "at" >= ${new Date(cutoff).toISOString()}::timestamptz`)
    if (spanRuns.length) {
      // Session Runs only: Runner Runs have `source = 'gateway'` rows from reconcile-costs. A (Run, model) no longer in any group was attributed elsewhere on this pass.
      const kept = keep.length ? sql`AND (e."run_id", e."model") NOT IN (${sql.join(keep.map(([r, m]) => sql`(${Number(r)}::int, ${m}::text)`), sql`, `)})` : sql``
      await tx.execute(sql`DELETE FROM "usage_entries" e USING "runs" r WHERE e."run_id" = r."id" AND r."mode" = 'session' AND e."source" = 'gateway' AND e."run_id" IN (${sql.join(spanRuns.map((r) => sql`${r}::int`), sql`, `)}) ${kept}`)
    }
    for (const g of groups) {
      const cost = costOf(g)
      const role = g.span?.role ?? g.role ?? g.session?.role ?? null
      if (g.span) {
        runIds.add(g.span.runId)
        await tx.execute(sql`
          INSERT INTO "usage_entries" ("workspace_id", "run_id", "session_id", "ticket_id", "stage", "role", "model", "provider", "tokens_in", "tokens_out", "cache_read", "cache_write", "cost_usd", "source", "at")
          VALUES (${g.workspace}, ${g.span.runId}, ${g.session?.id ?? null}, ${g.span.ticketId}, ${g.span.stage}, ${role}, ${g.model}, ${g.provider}, ${g.tin}, ${g.tout}, ${g.cr}, ${g.cw}, ${cost}, 'gateway', ${new Date(g.at).toISOString()}::timestamptz)
          ON CONFLICT ("run_id", "source", "model") DO UPDATE SET "tokens_in" = EXCLUDED."tokens_in", "tokens_out" = EXCLUDED."tokens_out", "cache_read" = EXCLUDED."cache_read", "cache_write" = EXCLUDED."cache_write", "cost_usd" = EXCLUDED."cost_usd", "provider" = EXCLUDED."provider", "updated_at" = now()`)
      } else {
        await tx.execute(sql`
          INSERT INTO "usage_entries" ("workspace_id", "run_id", "session_id", "role", "model", "provider", "tokens_in", "tokens_out", "cache_read", "cache_write", "cost_usd", "source", "at")
          VALUES (${g.workspace}, NULL, ${g.session?.id ?? null}, ${role}, ${g.model}, ${g.provider}, ${g.tin}, ${g.tout}, ${g.cr}, ${g.cw}, ${cost}, 'gateway', ${new Date(g.at).toISOString()}::timestamptz)`)
      }
    }
  })
  for (const id of new Set([...runIds, ...spanRuns])) await syncRunFromGateway(payload, id)
  await repriceUnpriced(payload)
  return { calls: calls.length, runs: runIds.size }
}

/** A session Run priced from the gateway: its own money fields follow the gateway rows (the session-reported rows are then ignored by Insights). */
const syncRunFromGateway = (payload: Payload, run: number) =>
  payload.db.drizzle.execute(sql`
    UPDATE "runs" r SET "gateway_tokens_in" = s."tin", "gateway_tokens_out" = s."tout", "gateway_tokens_total" = s."tin" + s."tout", "gateway_cost_usd" = s."cost",
      "cost_source" = CASE WHEN s."n" > 0 THEN 'gateway'::"enum_runs_cost_source" WHEN r."cost_source" = 'gateway' THEN 'sdk-estimate'::"enum_runs_cost_source" ELSE r."cost_source" END, "updated_at" = now()
    FROM (SELECT count(*) AS "n", sum(COALESCE("tokens_in", 0) + COALESCE("cache_read", 0) + COALESCE("cache_write", 0)) AS "tin", sum(COALESCE("tokens_out", 0)) AS "tout", sum("cost_usd") AS "cost" FROM "usage_entries" WHERE "run_id" = ${run} AND "source" = 'gateway') s
    WHERE r."id" = ${run} AND r."mode" = 'session'`)

export type GatewayHealth = { checkedAt: string; up: boolean; message: string | null; migration: number | null }
/** Newest request-log migration the pinned image (v1.7.0) knows; a database ahead of it means the image was downgraded, which makes the gateway crash-loop. */
export const KNOWN_REQUEST_LOG_MIGRATION = 3

/** Probes the gateway and its request-log database and stores the answer (instance_state `gateway`) for pages to read. Any HTTP answer on the LLM port, even 401, means it is running. */
export const checkGateway = async (payload: Payload, now = Date.now()): Promise<GatewayHealth> => {
  let migration: number | null = null
  try {
    const client = new pg.Client({ connectionString: process.env.GATEWAY_DATABASE_URL })
    await client.connect()
    try {
      migration = Number((await client.query(`SELECT max(version) AS v FROM _agentgateway_request_log_migrations`)).rows[0]?.v ?? 0) || null
    } finally {
      await client.end()
    }
  } catch {
    // the database is checked below through the probe result
  }
  const up = await fetch(`${process.env.GATEWAY_URL}/v1/models`, { signal: AbortSignal.timeout(3000) }).then(() => true, () => false)
  const ahead = migration != null && migration > KNOWN_REQUEST_LOG_MIGRATION
  const message = up ? null : ahead ? `The gateway is not running and its database is newer (migration ${migration}) than this image knows (${KNOWN_REQUEST_LOG_MIGRATION}). Never downgrade the gateway image: start the version you ran before, or a newer one.` : 'The gateway does not answer. Check `docker compose logs gateway`.'
  const health: GatewayHealth = { checkedAt: new Date(now).toISOString(), up, message, migration }
  await setState(payload, 'gateway', health)
  return health
}
