import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { title as stageTitle, type Workflow } from '../../../lib/workflow'

export type Row = { run: number | null; group: string; executor: string; ticket: number | null; number: number | null; ticketTitle: string | null; stage: string | null; role: string | null; model: string; source: string; tokens: number; cache: number; cost: number | null; at: string }
export type Line = { key: string; label: string; costUsd: number; tokens: number; cache: number; runs: number; unpriced: number; number?: number; id?: number; /** Help text of the label (shown as a tooltip). */ hint?: string }
export type Quantiles = { n: number; median: number; p85: number }
export type Cost = {
  totalUsd: number
  tokens: number
  cache: number
  unpriced: number
  byModel: Line[]
  byRole: Line[]
  bySession: Line[]
  byStage: (Line & { perTicket: Quantiles | null })[]
  topTickets: Line[]
  perTicket: Quantiles | null
  doneTickets: { total: number; priced: number }
  coverage: { label: string; runs: number; covered: number }[]
  sources: Record<string, number>
}

export const quantile = (xs: number[], q: number): number => {
  const s = [...xs].sort((a, b) => a - b)
  const at = (s.length - 1) * q
  const lo = Math.floor(at)
  return s[lo]! + (s[Math.ceil(at)]! - s[lo]!) * (at - lo)
}
const quantiles = (xs: number[]): Quantiles | null => (xs.length ? { n: xs.length, median: quantile(xs, 0.5), p85: quantile(xs, 0.85) } : null)

/** Sums the rows by `key`; `labelOf` names a group, `runs` counts distinct Runs. */
export const group = (rows: Row[], key: (r: Row) => string | null, label: (r: Row) => string = (r) => key(r)!): Line[] => {
  const m = new Map<string, Line & { set: Set<number> }>()
  for (const r of rows) {
    const k = key(r)
    if (k == null) continue
    const l = m.get(k) ?? { key: k, label: label(r), costUsd: 0, tokens: 0, cache: 0, runs: 0, unpriced: 0, set: new Set<number>() }
    l.costUsd += r.cost ?? 0
    l.tokens += r.tokens
    l.cache += r.cache
    l.unpriced += r.cost == null && r.tokens > 0 ? 1 : 0
    if (r.run != null) l.set.add(r.run)
    m.set(k, l)
  }
  return [...m.values()].map(({ set, ...l }) => ({ ...l, runs: set.size })).sort((a, b) => b.costUsd - a.costUsd || a.key.localeCompare(b.key))
}

/** Per-Ticket totals of `rows` (all Runs of each Ticket). */
const perTicket = (rows: Row[]): Map<number, number> => {
  const m = new Map<number, number>()
  for (const r of rows) if (r.ticket != null) m.set(r.ticket, (m.get(r.ticket) ?? 0) + (r.cost ?? 0))
  return m
}

const NO_ROLE: Record<string, string> = { runner: 'Runner, no role', ci: 'CI, no role', session: 'Session, no role' }

/** Pure aggregation of effective usage rows into the Insights breakdowns. `done` is the whole history of the Tickets that reached done in the range. */
export const aggregate = (wf: Workflow, rows: Row[], done: { ids: number[]; rows: Row[] }, coverage: Cost['coverage']): Cost => {
  const doneCost = perTicket(done.rows)
  const priced = done.ids.filter((id) => doneCost.has(id))
  const stageCost = new Map<string, number[]>()
  for (const id of priced) {
    const per = new Map<string, number>()
    for (const r of done.rows) if (r.ticket === id && r.stage) per.set(r.stage, (per.get(r.stage) ?? 0) + (r.cost ?? 0))
    for (const [stage, c] of per) stageCost.set(stage, [...(stageCost.get(stage) ?? []), c])
  }
  const sources: Record<string, number> = {}
  for (const r of rows) sources[r.source] = (sources[r.source] ?? 0) + (r.cost ?? 0)
  return {
    totalUsd: rows.reduce((a, r) => a + (r.cost ?? 0), 0),
    tokens: rows.reduce((a, r) => a + r.tokens, 0),
    cache: rows.reduce((a, r) => a + r.cache, 0),
    unpriced: rows.filter((r) => r.cost == null && r.tokens > 0).length,
    byModel: group(rows, (r) => r.model, (r) => (r.model === 'unknown' ? 'Not recorded' : r.model)).map((l) => (l.key === 'unknown' ? { ...l, hint: 'Runs from before models were recorded' } : l)),
    byRole: group(rows, (r) => r.role ?? `-${r.executor}`, (r) => (r.source === 'chat' ? 'Chat' : r.role ? (wf.roles.find((x) => x.id === r.role)?.title ?? r.role) : NO_ROLE[r.executor] ?? NO_ROLE.runner!)),
    bySession: group(rows, (r) => r.group),
    byStage: group(rows, (r) => r.stage ?? (r.source === 'chat' ? '-chat' : '-none'), (r) => (r.stage ? stageTitle(wf, r.stage) : r.source === 'chat' ? 'Chat' : 'No stage')).map((l) => ({ ...l, perTicket: quantiles(stageCost.get(l.key) ?? []) })),
    topTickets: group(rows, (r) => (r.ticket == null ? null : String(r.ticket)), (r) => r.ticketTitle ?? '').slice(0, 10).map((l) => {
      const r = rows.find((x) => String(x.ticket) === l.key)!
      return { ...l, id: r.ticket!, number: r.number ?? undefined }
    }),
    perTicket: quantiles(priced.map((id) => doneCost.get(id)!)),
    doneTickets: { total: done.ids.length, priced: priced.length },
    coverage,
    sources,
  }
}

const COLS = sql`e."run_id", e."ticket_id", e."stage", e."role", e."model", e."source"::text AS "source", COALESCE(e."tokens_in", 0)::float8 + COALESCE(e."tokens_out", 0)::float8 AS "tokens", (COALESCE(e."cache_read", 0) + COALESCE(e."cache_write", 0))::float8 AS "cache", e."cost_usd"::float8 AS "cost", e."at"`
/**
 * Session-reported rows are dropped once the gateway has priced the same thing (the gateway is exact): a Run with gateway rows, and every row of a session at or after that session's first gateway row.
 * So a session that moves from the usage hook to the gateway never counts a call twice.
 */
const EFFECTIVE = sql`NOT (e."source" = 'session-reported' AND (
  (e."run_id" IS NOT NULL AND EXISTS (SELECT 1 FROM "usage_entries" g WHERE g."run_id" = e."run_id" AND g."source" = 'gateway'))
  OR (e."session_id" IS NOT NULL AND EXISTS (SELECT 1 FROM "usage_entries" g WHERE g."session_id" = e."session_id" AND g."source" = 'gateway' AND g."at" <= e."at"))))`

const toRow = (r: Record<string, any>): Row => ({
  run: r.run_id == null ? null : Number(r.run_id),
  group: r.session_label ?? (r.source === 'chat' ? 'Chat' : r.executor === 'ci' ? 'CI' : r.source === 'gateway' && r.run_id == null ? 'Unnamed gateway session' : 'Runner'),
  executor: r.session_label ? 'session' : r.source === 'chat' ? 'chat' : r.source === 'gateway' && r.run_id == null ? 'session' : (r.executor ?? 'runner'),
  ticket: r.ticket_id == null ? null : Number(r.ticket_id),
  number: r.number == null ? null : Number(r.number),
  ticketTitle: r.title ?? null,
  stage: r.stage ?? null,
  role: r.role ?? null,
  model: r.model,
  source: r.source,
  tokens: Number(r.tokens),
  cache: Number(r.cache),
  cost: r.cost == null ? null : Number(r.cost),
  at: new Date(r.at).toISOString(),
})

/** Effective usage rows of the Workspace since `since` (optionally one Product), with their Ticket, session label and Run executor; chat answers are read from `chat_messages`. */
export const loadRows = async (payload: Payload, workspace: number, since: Date, product: number | null): Promise<Row[]> => {
  const s = since.toISOString()
  const rows = (await payload.db.drizzle.execute(sql`
    SELECT ${COLS}, t."number", t."title", COALESCE(s."label", s."public_id") AS "session_label", r."executor"
    FROM "usage_entries" e
    LEFT JOIN "tickets" t ON t."id" = e."ticket_id"
    LEFT JOIN "agent_sessions" s ON s."id" = e."session_id"
    LEFT JOIN "runs" r ON r."id" = e."run_id"
    WHERE e."workspace_id" = ${workspace} AND e."at" >= ${s}::timestamptz AND ${EFFECTIVE} ${product ? sql`AND t."product_id" = ${product}::int` : sql``}
    ${product ? sql`` : sql`UNION ALL
    SELECT NULL, NULL, NULL, 'chat', COALESCE(m."answer"->>'model', 'unknown'), 'chat', COALESCE((m."answer"->>'tokensIn')::float8, 0) + COALESCE((m."answer"->>'tokensOut')::float8, 0), 0::float8, (m."answer"->>'costUsd')::float8, m."created_at", NULL, NULL, NULL, NULL
    FROM "chat_messages" m WHERE m."workspace_id" = ${workspace} AND m."answer" IS NOT NULL AND m."created_at" >= ${s}::timestamptz`}`)).rows as Record<string, any>[]
  return rows.map(toRow)
}

/** Share of the Runs finished since `since` that have usage, by who ran them. */
const loadCoverage = async (payload: Payload, workspace: number, since: Date, product: number | null): Promise<Cost['coverage']> => {
  const rows = (await payload.db.drizzle.execute(sql`
    SELECT r."mode"::text AS "mode", count(*)::int AS "runs", count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "usage_entries" e WHERE e."run_id" = r."id"))::int AS "covered"
    FROM "runs" r ${product ? sql`JOIN "tickets" t ON t."id" = r."ticket_id" AND t."product_id" = ${product}::int` : sql``}
    WHERE r."workspace_id" = ${workspace} AND r."finished_at" >= ${since.toISOString()}::timestamptz AND r."status" IN ('succeeded', 'failed', 'needs_human')
    GROUP BY r."mode"`)).rows as { mode: string; runs: number; covered: number }[]
  const of = (mode: string) => {
    const r = rows.find((x) => x.mode === mode)
    return { runs: r?.runs ?? 0, covered: r?.covered ?? 0 }
  }
  return [{ label: 'Runner and CI Runs (gateway)', ...of('autonomous') }, { label: 'Session Runs (gateway or reported)', ...of('session') }]
}

/** The "Cost & tokens" numbers of the last `days` days; cost per finished Ticket uses the Tickets that reached done in the range, with their whole history. */
export const loadCost = async (payload: Payload, wf: Workflow, workspace: number, o: { days: number; product: number | null; now?: number }): Promise<Cost> => {
  const since = new Date((o.now ?? Date.now()) - o.days * 864e5)
  const [rows, coverage, done] = await Promise.all([
    loadRows(payload, workspace, since, o.product),
    loadCoverage(payload, workspace, since, o.product),
    payload.db.drizzle.execute(sql`
      SELECT DISTINCT ev."ticket_id" FROM "ticket_events" ev ${o.product ? sql`JOIN "tickets" t ON t."id" = ev."ticket_id" AND t."product_id" = ${o.product}::int` : sql``}
      WHERE ev."workspace_id" = ${workspace} AND ev."phase" = 'closed' AND ev."at" >= ${since.toISOString()}::timestamptz AND ev."ticket_id" IS NOT NULL`).then((r) => (r.rows as { ticket_id: number }[]).map((x) => Number(x.ticket_id))),
  ])
  const doneRows = done.length
    ? ((await payload.db.drizzle.execute(sql`SELECT ${COLS}, NULL AS "number", NULL AS "title", NULL AS "session_label", NULL AS "executor" FROM "usage_entries" e WHERE e."workspace_id" = ${workspace} AND e."ticket_id" IN (${sql.join(done.map((id) => sql`${id}`), sql`, `)}) AND ${EFFECTIVE}`)).rows as Record<string, any>[]).map(toRow)
    : []
  return aggregate(wf, rows, { ids: done, rows: doneRows }, coverage)
}

export type TeamCost = { sessions: Record<string, { today: number; d30: number }>; roles: Record<string, { today: number; d30: number }> }

/** Cost today and in the last 30 days per session (public id) and per role. DB only. */
export const loadTeamCost = async (payload: Payload, workspace: number, now = Date.now()): Promise<TeamCost> => {
  const rows = (await payload.db.drizzle.execute(sql`
    SELECT s."public_id", COALESCE(e."role", s."role") AS "role",
      COALESCE(sum(e."cost_usd") FILTER (WHERE e."at" >= date_trunc('day', ${new Date(now).toISOString()}::timestamptz)), 0)::float8 AS "today", COALESCE(sum(e."cost_usd"), 0)::float8 AS "d30"
    FROM "usage_entries" e LEFT JOIN "agent_sessions" s ON s."id" = e."session_id"
    WHERE e."workspace_id" = ${workspace} AND e."at" >= ${new Date(now - 30 * 864e5).toISOString()}::timestamptz AND ${EFFECTIVE}
    GROUP BY s."public_id", COALESCE(e."role", s."role")`)).rows as { public_id: string | null; role: string | null; today: number; d30: number }[]
  const out: TeamCost = { sessions: {}, roles: {} }
  const add = (m: Record<string, { today: number; d30: number }>, k: string, r: { today: number; d30: number }) => {
    const x = (m[k] ??= { today: 0, d30: 0 })
    x.today += r.today
    x.d30 += r.d30
  }
  for (const r of rows) {
    if (r.public_id) add(out.sessions, r.public_id, r)
    if (r.role) add(out.roles, r.role, r)
  }
  return out
}
