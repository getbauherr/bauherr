import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

type Doc = Record<string, any>

export const costSplit = (runs: Doc[]): { unreported: Doc[]; priced: Doc[]; estimated: boolean; total: number } => {
  const unreported = runs.filter((r) => r.executor === 'session' && !(Number(r.costUsd) > 0) && !(Number(r.tokensIn) > 0) && !(Number(r.tokensOut) > 0) && !(Number(r.gatewayTokensTotal) > 0))
  const priced = runs.filter((r) => r.costUsd != null && !unreported.includes(r))
  return { unreported, priced, estimated: priced.some((r) => r.costSource !== 'gateway'), total: priced.reduce((n, r) => n + Number(r.costUsd), 0) }
}

export type Usage = { tokensIn: number; tokensOut: number; cacheRead: number; cacheWrite: number; costUsd?: number; model?: string }
type Rates = { input: number; output: number; cacheRead: number; cacheWrite: number }

const catalogDirs = () => [join(process.env.GATEWAY_CONFIG_DIR ?? '/gateway', 'catalogs'), resolve(process.cwd(), '../../deploy/gateway/catalogs')]
const FIRST_PARTY = ['anthropic', 'openai', 'gcp.gemini', 'mistral', 'xai', 'deepseek', 'greenpt']
type CatalogFile = { metadata?: { generatedAt?: string }; providers?: Record<string, { models?: Record<string, { rates?: Record<string, string> }> }> }

let loaded: { at: number; sig: string; rates: Map<string, Rates> } | undefined

const catalog = (): Map<string, Rates> => {
  if (loaded && Date.now() - loaded.at < 10_000) return loaded.rates
  for (const dir of catalogDirs()) {
    let files: string[]
    try {
      files = readdirSync(dir).filter((x) => x.endsWith('.json')).sort()
    } catch {
      continue
    }
    const sig = files.map((f) => `${dir}/${f}:${statSync(join(dir, f)).mtimeMs}`).join('|')
    if (!files.length) continue
    if (loaded?.sig === sig) return (loaded.at = Date.now(), loaded.rates)
    const parsed = files.flatMap((f) => {
      try {
        return [JSON.parse(readFileSync(join(dir, f), 'utf8')) as CatalogFile]
      } catch {
        return []
      }
    })
    const base = parsed.filter((c) => c.metadata?.generatedAt).sort((a, b) => b.metadata!.generatedAt!.localeCompare(a.metadata!.generatedAt!))[0]
    const out = new Map<string, Rates>()
    const rank = (p: string) => (FIRST_PARTY.includes(p) ? FIRST_PARTY.indexOf(p) : FIRST_PARTY.length)
    const add = (c: CatalogFile | undefined, overlay: boolean) => {
      for (const [, p] of Object.entries(c?.providers ?? {}).sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))) {
        for (const [name, m] of Object.entries(p.models ?? {})) {
          if (m.rates?.input == null || m.rates.output == null || (!overlay && out.has(name))) continue
          out.set(name, { input: +m.rates.input, output: +m.rates.output, cacheRead: +(m.rates.cacheRead ?? m.rates.input), cacheWrite: +(m.rates.cacheWrite ?? m.rates.input) })
        }
      }
    }
    add(base, false)
    for (const c of parsed.filter((x) => !x.metadata?.generatedAt)) add(c, true)
    if (out.size) {
      loaded = { at: Date.now(), sig, rates: out }
      return out
    }
  }
  return (loaded = { at: Date.now(), sig: '', rates: new Map() }).rates
}

export const reloadCatalog = (): void => {
  loaded = undefined
}

export const modelName = (m: string | null | undefined): string => (m ?? '').replace(/\[.*\]$/, '').split('/').pop() || 'unknown'

export const priceOf = (model: string, u: Pick<Usage, 'tokensIn' | 'tokensOut' | 'cacheRead' | 'cacheWrite'>): number | null => {
  const name = modelName(model)
  const r = catalog().get(name) ?? [...catalog()].find(([k]) => name.startsWith(k))?.[1]
  return r ? (u.tokensIn * r.input + u.tokensOut * r.output + u.cacheRead * r.cacheRead + u.cacheWrite * r.cacheWrite) / 1e6 : null
}

const num = (v: unknown, what: string): number => {
  if (v === undefined || v === null) return 0
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`usage.${what} must be a non-negative number`)
  return v
}

export const parseUsage = (v: unknown): Usage => {
  const u = (v ?? {}) as Doc
  if (typeof v !== 'object' || v === null) throw new Error('usage must be an object')
  const costUsd = u.costUsd === undefined ? undefined : num(u.costUsd, 'costUsd')
  return { tokensIn: num(u.tokensIn, 'tokensIn'), tokensOut: num(u.tokensOut, 'tokensOut'), cacheRead: num(u.cacheRead, 'cacheRead'), cacheWrite: num(u.cacheWrite, 'cacheWrite'), ...(costUsd !== undefined && { costUsd }), ...(typeof u.model === 'string' && u.model && { model: u.model.slice(0, 120) }) }
}

type Ctx = { workspace: number; run: number | null; session: number | null; ticket: number | null; stage: string | null; role: string | null }

const runCtx = async (payload: Payload, run: number | string): Promise<Doc> =>
  (await payload.db.drizzle.execute(sql`SELECT "workspace_id", "ticket_id", "stage", "role", "session_id", "model", "provider" FROM "runs" WHERE "id" = ${run}`)).rows[0] as Doc

const syncRun = (payload: Payload, run: number | string) =>
  payload.db.drizzle.execute(sql`
    UPDATE "runs" r SET "tokens_in" = s."tin", "tokens_out" = s."tout", "tokens_cache" = s."cache", "cost_estimate_usd" = s."cost",
      "cost_source" = CASE WHEN r."cost_source" = 'gateway' THEN r."cost_source" ELSE 'session-reported'::"enum_runs_cost_source" END, "updated_at" = now()
    FROM (SELECT sum("tokens_in") AS "tin", sum("tokens_out") AS "tout", sum(COALESCE("cache_read", 0) + COALESCE("cache_write", 0)) AS "cache", sum("cost_usd") AS "cost" FROM "usage_entries" WHERE "run_id" = ${run} AND "source" = 'session-reported') s
    WHERE r."id" = ${run}`)

export const saveGatewayUsage = async (payload: Payload, run: number | string, rows: { model: string | null; tokensIn: number; tokensOut: number; costUsd: number | null }[]): Promise<void> => {
  const r = await runCtx(payload, run)
  for (const x of rows) {
    const parts = (x.model ?? '').replace(/^ws-[^/]+\//, '').split('/')
    const model = modelName(x.model)
    const provider = parts.length > 1 ? parts[0]! : r.provider
    await payload.db.drizzle.execute(sql`
      INSERT INTO "usage_entries" ("workspace_id", "run_id", "session_id", "ticket_id", "stage", "role", "model", "provider", "tokens_in", "tokens_out", "cost_usd", "source", "at")
      VALUES (${r.workspace_id}, ${run}, ${r.session_id}, ${r.ticket_id}, ${r.stage}, ${r.role}, ${model}, ${provider}, ${x.tokensIn}, ${x.tokensOut}, ${x.costUsd}, 'gateway', now())
      ON CONFLICT ("run_id", "source", "model") DO UPDATE SET "tokens_in" = EXCLUDED."tokens_in", "tokens_out" = EXCLUDED."tokens_out", "cost_usd" = EXCLUDED."cost_usd", "provider" = EXCLUDED."provider", "updated_at" = now()`)
  }
}

export const reportRunUsage = async (payload: Payload, run: number | string, session: Doc | undefined, input: unknown): Promise<{ stored: boolean; note?: string }> => {
  const u = parseUsage(input)
  if (session && (await payload.db.drizzle.execute(sql`SELECT 1 FROM "usage_cursors" WHERE "session_id" = ${session.id} LIMIT 1`)).rows.length) return { stored: false, note: 'the usage hook of this session reports already; usage ignored' }
  const r = await runCtx(payload, run)
  const model = modelName(u.model ?? session?.model ?? r.model)
  const cost = u.costUsd ?? priceOf(model, u)
  await payload.db.drizzle.execute(sql`
    INSERT INTO "usage_entries" ("workspace_id", "run_id", "session_id", "ticket_id", "stage", "role", "model", "provider", "tokens_in", "tokens_out", "cache_read", "cache_write", "cost_usd", "source", "at")
    VALUES (${r.workspace_id}, ${run}, ${r.session_id}, ${r.ticket_id}, ${r.stage}, ${r.role}, ${model}, ${session?.provider ?? r.provider}, ${u.tokensIn}, ${u.tokensOut}, ${u.cacheRead}, ${u.cacheWrite}, ${cost}, 'session-reported', now())
    ON CONFLICT ("run_id", "source", "model") DO UPDATE SET "tokens_in" = GREATEST(usage_entries."tokens_in", EXCLUDED."tokens_in"), "tokens_out" = GREATEST(usage_entries."tokens_out", EXCLUDED."tokens_out"),
      "cache_read" = GREATEST(usage_entries."cache_read", EXCLUDED."cache_read"), "cache_write" = GREATEST(usage_entries."cache_write", EXCLUDED."cache_write"),
      "cost_usd" = GREATEST(usage_entries."cost_usd", EXCLUDED."cost_usd"), "updated_at" = now(), "at" = now()`)
  await syncRun(payload, run)
  return { stored: true }
}

type Totals = Record<string, [number, number, number, number]>
const FRESH_MS = 15 * 60_000

export const reportDelta = async (payload: Payload, who: { owner: number | string; keyId: number | string }, body: { claudeSession: string; firstAt?: string; models: Totals; clientKey?: string }): Promise<{ run: number | null; delta: Record<string, number> }> => {
  if (!body.claudeSession || typeof body.models !== 'object' || !body.models) throw new Error('claudeSession and models are required')
  const totals = Object.entries(body.models).map(([m, v]) => [modelName(m), v.map((n, i) => num(n, String(i)))] as const)
  return payload.db.drizzle.transaction(async (tx) => {
    const found = (await tx.execute(sql`SELECT "id" FROM "agent_sessions" WHERE "owner_id" = ${who.owner} AND "disconnected_at" IS NULL AND ${body.clientKey ? sql`"client_key" = ${body.clientKey}` : sql`"agent_key_id" = ${who.keyId}`} ORDER BY "last_seen_at" DESC`)).rows as Doc[]
    if (!found.length) throw new Error('no connected session for this key; connect first')
    if (found.length > 1 && !body.clientKey) throw new Error('several sessions use this key; set BAUHERR_SESSION to the session key you pass to connect')
    const s = (await tx.execute(sql`SELECT "id", "connected_at", "role", "provider", "workspace_id" FROM "agent_sessions" WHERE "id" = ${found[0]!.id} FOR UPDATE`)).rows[0] as Doc
    const before = ((await tx.execute(sql`SELECT "totals" FROM "usage_cursors" WHERE "session_id" = ${s.id} AND "claude_session" = ${body.claudeSession}`)).rows[0] as { totals: Totals } | undefined)?.totals
    const fresh = !!body.firstAt && new Date(s.connected_at).getTime() - Date.parse(body.firstAt) <= FRESH_MS
    const base: Totals = before ?? (fresh ? {} : Object.fromEntries(totals.map(([m, v]) => [m, v as [number, number, number, number]])))
    const run = (await tx.execute(sql`SELECT "id", "ticket_id", "stage", "role" FROM "runs" WHERE "session_id" = ${s.id} AND "status" = 'running' ORDER BY "started_at" DESC LIMIT 1`)).rows[0] as Doc | undefined
    const delta: Record<string, number> = { tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0 }
    const next: Totals = {}
    for (const [model, v] of totals) {
      next[model] = v as [number, number, number, number]
      const b = base[model] ?? [0, 0, 0, 0]
      const d = v.map((n, i) => Math.max(0, n - (b[i] ?? 0)))
      if (!d.some((n) => n > 0)) continue
      const u = { tokensIn: d[0]!, tokensOut: d[1]!, cacheRead: d[2]!, cacheWrite: d[3]! }
      for (const k of Object.keys(delta)) delta[k]! += u[k as keyof typeof u]
      const cost = priceOf(model, u)
      const same = sql`"session_id" = ${s.id} AND "source" = 'session-reported' AND "model" = ${model} AND "run_id" IS NOT DISTINCT FROM ${run?.id ?? null}::int`
      const updated = await tx.execute(sql`UPDATE "usage_entries" SET "tokens_in" = COALESCE("tokens_in", 0) + ${u.tokensIn}, "tokens_out" = COALESCE("tokens_out", 0) + ${u.tokensOut}, "cache_read" = COALESCE("cache_read", 0) + ${u.cacheRead}, "cache_write" = COALESCE("cache_write", 0) + ${u.cacheWrite}, "cost_usd" = CASE WHEN ${cost}::numeric IS NULL THEN "cost_usd" ELSE COALESCE("cost_usd", 0) + ${cost} END, "at" = now(), "updated_at" = now() WHERE ${same} RETURNING "id"`)
      if (!updated.rows.length) {
        await tx.execute(sql`INSERT INTO "usage_entries" ("workspace_id", "run_id", "session_id", "ticket_id", "stage", "role", "model", "provider", "tokens_in", "tokens_out", "cache_read", "cache_write", "cost_usd", "source", "at") VALUES (${s.workspace_id}, ${run?.id ?? null}, ${s.id}, ${run?.ticket_id ?? null}, ${run?.stage ?? null}, ${run?.role ?? s.role}, ${model}, ${s.provider}, ${u.tokensIn}, ${u.tokensOut}, ${u.cacheRead}, ${u.cacheWrite}, ${cost}, 'session-reported', now())`)
      }
    }
    await tx.execute(sql`INSERT INTO "usage_cursors" ("workspace_id", "session_id", "claude_session", "totals") VALUES (${s.workspace_id}, ${s.id}, ${body.claudeSession}, ${JSON.stringify(next)}::jsonb) ON CONFLICT ("session_id", "claude_session") DO UPDATE SET "totals" = EXCLUDED."totals", "updated_at" = now()`)
    return { run: run ? Number(run.id) : null, delta, runId: run?.id }
  }).then(async (r) => {
    if (r.runId != null) await syncRun(payload, r.runId)
    return { run: r.run, delta: r.delta }
  })
}
