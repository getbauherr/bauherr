import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { parseDocument, stringify } from 'yaml'
import { personOf } from './person'
import { STALE } from './workflow-labels'
import { compile, corePack, DEFAULT, kindOf, lint, packDir, wipStages, type Workflow } from './workflow'

type Doc = Record<string, any>
const o = { overrideAccess: true, depth: 0 } as const

const TTL_MS = 5000
type Cache = { map: Map<number, Workflow>; at: number }
/** On globalThis: Next bundles pages and server actions as separate module instances of one process, and an apply in one must reach the others. */
const shared = globalThis as { __bauherrWorkflows?: Cache; __bauherrWorkflowsGen?: number }

/** Loads the active workflow of every Workspace that has an applied factory file; at most once per 5 s per process (the app, worker and poller each keep their own copy, so a change reaches them within that time). */
export const loadWorkflows = async (payload: Payload): Promise<void> => {
  if (shared.__bauherrWorkflows && Date.now() - shared.__bauherrWorkflows.at < TTL_MS) return
  const gen = shared.__bauherrWorkflowsGen ?? 0
  const rows = (await payload.db.drizzle.execute(sql`SELECT w."id", v."compiled" FROM "workspaces" w JOIN "workflow_versions" v ON v."id" = w."workflow_version_id"`)).rows as { id: number; compiled: Workflow }[]
  const stale = (shared.__bauherrWorkflowsGen ?? 0) !== gen // an apply landed while this read was in flight: its answer may predate it, so it must not replace the apply's entry nor be trusted for the TTL
  if (stale && shared.__bauherrWorkflows) return
  shared.__bauherrWorkflows = { map: new Map(rows.map((r) => [Number(r.id), r.compiled])), at: stale ? 0 : Date.now() }
}

/** Makes the next `loadWorkflows` read the database. */
export const invalidateWorkflows = (): void => {
  shared.__bauherrWorkflowsGen = (shared.__bauherrWorkflowsGen ?? 0) + 1
  if (shared.__bauherrWorkflows) shared.__bauherrWorkflows.at = 0
}

/** The workflow of a Workspace: its applied factory file, else the pack default. Sync; throws when this process never ran `loadWorkflows` (a missing call at an entry point). `null`/`undefined` is code that is not Workspace-scoped and gets the pack default. */
export const workflowFor = (workspace: number | string | { id: number | string } | null | undefined): Workflow => {
  const cache = shared.__bauherrWorkflows
  if (!cache) throw new Error('workflowFor called before loadWorkflows: await loadWorkflows(payload) at the entry point')
  const id = typeof workspace === 'object' && workspace ? workspace.id : workspace
  return (id != null && cache.map.get(Number(id))) || DEFAULT()
}

const canonical = (v: unknown): unknown => (Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Doc)[k])])) : v)
const hashOf = (wf: Workflow) => createHash('sha256').update(JSON.stringify(canonical(wf))).digest('hex')

/** Inlines `profile_file` of every role as `profile`, reading relative to `dir`; a path that leaves `dir` is a finding. */
export const inlineProfiles = (doc: Doc, dir: string, findings: string[]): void => {
  for (const [id, r] of Object.entries((doc?.team?.roles ?? {}) as Record<string, Doc>)) {
    if (!r || typeof r !== 'object' || !r.profile_file) continue
    const path = resolve(dir, String(r.profile_file))
    if (!path.startsWith(resolve(dir) + sep)) findings.push(`role "${id}": profile_file must stay inside ${dir}`)
    else if (!existsSync(path)) findings.push(`role "${id}": profile_file "${r.profile_file}" not found`)
    else {
      r.profile = readFileSync(path, 'utf8')
      delete r.profile_file
    }
  }
}

const packFile = (): string => {
  const path = [packDir(), corePack()].map((d) => resolve(d, 'factory.yaml')).find(existsSync)
  if (!path) throw new Error('no factory.yaml in the pack')
  return path
}

/** The pack's factory file with the role profiles inlined. */
export const packSource = (): string => {
  const path = packFile()
  const doc = parseDocument(readFileSync(path, 'utf8')).toJS() as Doc
  inlineProfiles(doc, dirname(path), [])
  return stringify(doc)
}

export type FactoryOpts = { by: string; via: 'ui' | 'api' | 'cli' | 'boot' | 'seed'; note?: string; baseVersion?: number | null; dryRun?: boolean }
export type ApplyResult = { ok: boolean; findings: string[]; version?: number; changed: boolean; migrated: { from: string; to: string; tickets: number; runs: number }[]; /** Removed stages that still hold Tickets or active Runs and have no `workflow.migrate` entry (set with the findings). */ held?: { stage: string; tickets: number; runs: number }[] }

const LIVE_RUNS = sql`('queued', 'awaiting_session', 'running')`
class Stale extends Error {}

const contextFindings = async (payload: Payload, workspaceId: number, wf: Workflow): Promise<string[]> => {
  const out: string[] = []
  const skillOk = (n: unknown) => typeof n === 'string' && /^[\w-]+$/.test(n) && [packDir(), corePack()].some((d) => existsSync(resolve(d, 'skills', n, 'SKILL.md')))
  for (const s of wf.stages) if (s.skill && !skillOk(s.skill)) out.push(`stage "${s.name}": skill "${s.skill}" is not a skill of the pack (skills/${s.skill}/SKILL.md)`)
  const ws = (await payload.findByID({ collection: 'workspaces', id: workspaceId, select: { modelByTier: true }, ...o })) as Doc
  const conns = (await payload.find({ collection: 'connections', where: { workspace: { equals: workspaceId }, kind: { equals: 'llm-provider' } }, pagination: false, ...o })).docs as Doc[]
  const tiers = Object.keys(ws.modelByTier ?? {})
  for (const r of wf.roles) {
    if (r.provider && !conns.some((c) => c.slug === r.provider)) out.push(`role "${r.id}": provider "${r.provider}" is not an LLM Connection of this Workspace`)
    if (r.tier && !tiers.includes(r.tier)) out.push(`role "${r.id}": tier "${r.tier}" is not a tier of this Workspace (${tiers.join(', ')})`)
  }
  return out
}

type Row = { migrated: ApplyResult['migrated'] }

/**
 * Applies a factory file to a Workspace: parse, inline profiles, lint, context checks, compile; an unchanged file (same hash) is a no-op.
 * One transaction under a per-Workspace advisory lock writes the version, rewrites Tickets and Runs of renamed stages (`workflow.migrate`), accumulates `aliases`, drops the Workspace WIP overrides and moves the pointer (refused when `baseVersion` is stale).
 * `dryRun` returns the findings and what would migrate.
 */
export const applyFactory = async (payload: Payload, workspaceId: number, yaml: string, opts: FactoryOpts): Promise<ApplyResult> => {
  const fail = (findings: string[]): ApplyResult => ({ ok: false, findings, changed: false, migrated: [] })
  let doc: Doc
  try {
    const parsed = parseDocument(yaml)
    if (parsed.errors.length) return fail([`not valid YAML: ${parsed.errors[0].message}`])
    doc = parsed.toJS() as Doc
  } catch (e) {
    return fail([`not valid YAML: ${(e as Error).message}`])
  }
  const findings: string[] = []
  const hadFiles = Object.values((doc?.team?.roles ?? {}) as Record<string, Doc>).some((r) => r?.profile_file)
  inlineProfiles(doc, packDir(), findings)
  findings.push(...lint(doc))
  if (findings.length) return fail(findings)
  const wf = compile(doc)
  const ctx = await contextFindings(payload, workspaceId, wf)
  if (ctx.length) return fail(ctx)
  const hash = hashOf(wf)
  const migrate = (doc.workflow.migrate ?? {}) as Record<string, string>
  const source = hadFiles ? stringify(doc) : yaml
  const db = payload.db.drizzle

  const run = async (q: typeof db, write: boolean): Promise<ApplyResult> => {
    const prev = (await q.execute(sql`SELECT w."workflow_version_id" AS id, v."version", v."hash", v."compiled" FROM "workspaces" w LEFT JOIN "workflow_versions" v ON v."id" = w."workflow_version_id" WHERE w."id" = ${workspaceId}`)).rows[0] as { id: number | null; version: string | null; hash: string | null; compiled: Workflow | null } | undefined
    if (!prev) return fail([`no Workspace ${workspaceId}`])
    if (prev.hash === hash) return { ok: true, findings: [], version: Number(prev.version), changed: false, migrated: [] }
    if (opts.baseVersion !== undefined && Number(prev.version ?? 0) !== Number(opts.baseVersion ?? 0)) return fail([STALE])
    const old = prev.compiled ?? DEFAULT()
    const names = new Set(wf.stages.map((s) => s.name))
    const count = async (query: ReturnType<typeof sql>) => Number(((await q.execute(query)).rows[0] as { n: string }).n)
    const out: Row['migrated'] = []
    const problems: string[] = []
    const held: NonNullable<ApplyResult['held']> = []
    for (const s of old.stages) {
      if (names.has(s.name) || migrate[s.name]) continue
      const tickets = await count(sql`SELECT count(*) AS n FROM "tickets" WHERE "workspace_id" = ${workspaceId} AND "stage" = ${s.name}`)
      const runs = await count(sql`SELECT count(*) AS n FROM "runs" WHERE "workspace_id" = ${workspaceId} AND "stage" = ${s.name} AND "status" IN ${LIVE_RUNS}`)
      if (tickets || runs) {
        problems.push(`stage "${s.name}" is removed but holds ${tickets} Ticket(s) and ${runs} active Run(s): add workflow.migrate: {${s.name}: <stage>}`)
        held.push({ stage: s.name, tickets, runs })
      }
    }
    for (const [from, to] of Object.entries(migrate)) {
      const tickets = await count(sql`SELECT count(*) AS n FROM "tickets" WHERE "workspace_id" = ${workspaceId} AND ("stage" = ${from} OR "waiting_for" = ${from} OR "factory_stage" = ${from})`)
      const runs = await count(sql`SELECT count(*) AS n FROM "runs" WHERE "workspace_id" = ${workspaceId} AND "stage" = ${from}${kindOf(old, from) === kindOf(wf, to) ? sql`` : sql` AND "status" IN ${LIVE_RUNS}`}`)
      out.push({ from, to, tickets, runs })
    }
    if (problems.length) return { ...fail(problems), held }
    if (!write) return { ok: true, findings: [], changed: true, migrated: out }

    for (const m of out) {
      const same = kindOf(old, m.from) === kindOf(wf, m.to)
      if (!same) await q.execute(sql`UPDATE "runs" SET "status" = 'cancelled', "finished_at" = now(), "updated_at" = now() WHERE "workspace_id" = ${workspaceId} AND "stage" = ${m.from} AND "status" IN ${LIVE_RUNS}`)
      await q.execute(sql`UPDATE "tickets" SET "stage" = ${m.to} WHERE "workspace_id" = ${workspaceId} AND "stage" = ${m.from}`)
      await q.execute(sql`UPDATE "tickets" SET "waiting_for" = ${wipStages(wf).includes(m.to) ? m.to : null} WHERE "workspace_id" = ${workspaceId} AND "waiting_for" = ${m.from}`)
      await q.execute(sql`UPDATE "tickets" SET "factory_stage" = ${m.to} WHERE "workspace_id" = ${workspaceId} AND "factory_stage" = ${m.from}`)
      await q.execute(sql`UPDATE "tickets" SET "history_key" = ${m.to} || '|' || split_part("history_key", '|', 2) WHERE "workspace_id" = ${workspaceId} AND split_part("history_key", '|', 1) = ${m.from}`)
      if (same) await q.execute(sql`UPDATE "runs" SET "stage" = ${m.to} WHERE "workspace_id" = ${workspaceId} AND "stage" = ${m.from}`)
    }
    const aliases: Record<string, string> = {}
    for (const [a, b] of Object.entries({ ...old.aliases, ...wf.aliases, ...migrate })) {
      const to = migrate[b] ?? b
      if (!names.has(a) && names.has(to)) aliases[a] = to
    }
    const compiled = { ...wf, aliases }
    const version = Number(((await q.execute(sql`SELECT coalesce(max("version"), 0) + 1 AS n FROM "workflow_versions" WHERE "workspace_id" = ${workspaceId}`)).rows[0] as { n: string }).n)
    const row = (await q.execute(sql`INSERT INTO "workflow_versions" ("workspace_id", "version", "source", "compiled", "hash", "applied_by", "applied_via", "note") VALUES (${workspaceId}, ${version}, ${source}, ${JSON.stringify(compiled)}::jsonb, ${hash}, ${opts.by}, ${opts.via}, ${opts.note ?? null}) RETURNING "id"`)).rows[0] as { id: number }
    const moved = await q.execute(sql`UPDATE "workspaces" SET "workflow_version_id" = ${row.id}, "wip_limits" = NULL, "updated_at" = now() WHERE "id" = ${workspaceId} AND "workflow_version_id" IS NOT DISTINCT FROM ${prev.id} RETURNING "id"`)
    if (!moved.rows.length) throw new Stale()
    return { ok: true, findings: [], version, changed: true, migrated: out }
  }

  if (opts.dryRun) return run(db, false)
  let result: ApplyResult
  try {
    result = await db.transaction(async (tx: typeof db) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${workspaceId}::int, hashtext('factory'))`)
      return run(tx, true)
    })
  } catch (e) {
    if (e instanceof Stale) return fail([STALE])
    throw e
  }
  if (result.changed) {
    invalidateWorkflows()
    shared.__bauherrWorkflows?.map.set(workspaceId, (await payload.db.drizzle.execute(sql`SELECT v."compiled" FROM "workspaces" w JOIN "workflow_versions" v ON v."id" = w."workflow_version_id" WHERE w."id" = ${workspaceId}`)).rows[0]?.compiled as Workflow)
    if (opts.via !== 'boot' && opts.via !== 'seed') await payload.create({ collection: 'human_touches', data: { kind: 'apply:factory', workspace: workspaceId, actor: personOf({ email: opts.by }), at: new Date().toISOString() }, ...o })
  }
  return result
}

/** The active factory file of the Workspace, or the pack's with the role profiles inlined. */
export const exportFactory = async (payload: Payload, workspaceId: number): Promise<string> => {
  const row = (await payload.db.drizzle.execute(sql`SELECT v."source" FROM "workspaces" w JOIN "workflow_versions" v ON v."id" = w."workflow_version_id" WHERE w."id" = ${workspaceId}`)).rows[0] as { source: string | null } | undefined
  return row?.source ?? packSource()
}

/** What the Workspace runs now: its active version number and who applied it, or null for the pack default. */
export const activeVersion = async (payload: Payload, workspaceId: number): Promise<{ version: number; at: string; by: string | null; via: string | null; hash: string } | null> => {
  const r = (await payload.db.drizzle.execute(sql`SELECT v."version", v."created_at" AS at, v."applied_by" AS by, v."applied_via" AS via, v."hash" FROM "workspaces" w JOIN "workflow_versions" v ON v."id" = w."workflow_version_id" WHERE w."id" = ${workspaceId}`)).rows[0] as Doc | undefined
  return r ? { version: Number(r.version), at: new Date(r.at).toISOString(), by: r.by, via: r.via, hash: r.hash } : null
}

/** Hash of the shipped factory file as `applyFactory` computes it (profiles inlined), to tell "Shipped default" from "Custom workflow". */
export const defaultHash = (): string => hashOf(compile(parseDocument(packSource()).toJS()))

/** Boot: applies `BAUHERR_FACTORY_FILE` to `BAUHERR_FACTORY_WORKSPACE` (slug) or every Workspace. Idempotent by hash; an unreadable or invalid file is logged and the active version stays. */
export const applyBootFile = async (payload: Payload): Promise<void> => {
  const file = process.env.BAUHERR_FACTORY_FILE
  if (!file) return
  try {
    const doc = parseDocument(readFileSync(file, 'utf8')).toJS() as Doc
    const findings: string[] = []
    inlineProfiles(doc, dirname(resolve(file)), findings)
    if (findings.length) throw new Error(findings.join('; '))
    const yaml = stringify(doc)
    const slug = process.env.BAUHERR_FACTORY_WORKSPACE
    const spaces = (await payload.find({ collection: 'workspaces', ...(slug && { where: { slug: { equals: slug } } }), pagination: false, select: { slug: true }, ...o })).docs as Doc[]
    if (slug && !spaces.length) throw new Error(`no Workspace "${slug}"`)
    for (const w of spaces) {
      const r = await applyFactory(payload, w.id, yaml, { by: 'boot', via: 'boot', note: file })
      if (!r.ok) payload.logger.error(`BAUHERR_FACTORY_FILE ${file} not applied to ${w.slug}: ${r.findings.join('; ')}`)
      else if (r.changed) payload.logger.info(`BAUHERR_FACTORY_FILE applied to ${w.slug}: version ${r.version}`)
    }
  } catch (e) {
    payload.logger.error(`BAUHERR_FACTORY_FILE ${file} not applied: ${(e as Error).message}`)
  }
}

/** Init of every process that boots Payload: loads the workflows (a failure, e.g. an unmigrated schema, is logged and the pack default serves until the next load) and applies the boot file. */
export const bootFactory = async (payload: Payload): Promise<void> => {
  await loadWorkflows(payload).catch((e) => {
    shared.__bauherrWorkflows = { map: new Map(), at: 0 }
    payload.logger.error(`loadWorkflows failed at boot, using the pack default: ${(e as Error).message}`)
  })
  await applyBootFile(payload)
}
