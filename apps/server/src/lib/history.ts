import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { needsOf } from './needs-you'
import { cas } from './release'
import { gatesOf } from './staging'
import { activeVersion, workflowFor } from './factory'
import { is, type Kind, kindOf, nameOf, stage as stageDef, type Workflow } from './workflow'

type Doc = Record<string, any>
const o = { overrideAccess: true, depth: 0 } as const

export type Phase = 'working' | 'queued' | 'human' | 'ci' | 'closed'
export type Executor = 'session' | 'runner' | 'ci' | 'human' | 'factory'
type RunRow = { stage: string; kind?: string | null; status: string; reasonKind?: string | null } | null

export const phaseOf = (wf: Workflow, t: Doc, run: RunRow, gates?: Parameters<typeof needsOf>[4]): Phase => {
  const stage = t.stage ?? nameOf(wf, 'triage')
  if (t.state === 'closed' || is(wf, stage, 'done')) return 'closed'
  if (run && run.stage === stage && run.status === 'running') return 'working'
  if (run && run.stage === stage && (run.status === 'queued' || run.status === 'awaiting_session')) return 'queued'
  if (needsOf(wf, { ...t, stage }, run, false, gates)) return 'human'
  const at = (...k: Kind[]) => is(wf, stage, ...k)
  if (t.waitingFor === 'checks' || (at('review') && ['waiting_checks', 'queued'].includes(t.reviewState)) || (at('release') && (t.releaseState === 'waiting' || t.productionState === 'deploying')) || t.releaseChecksState === 'waiting') return 'ci'
  return 'queued'
}

type Opts = { cause: string; outcome?: string; note?: string; run?: number | string; actor?: string; executor?: Executor; stage?: string; phase?: Phase }

export const record = async (payload: Payload, ticketId: number | string, opts: Opts, loaded?: { ticket: Doc; run: Doc | null }): Promise<void> => {
  try {
    if (opts.stage && !loaded && ['scan', 'docs', 'distill'].includes(opts.stage)) return
    const ticket = loaded?.ticket ?? ((await payload.findByID({ collection: 'tickets', id: ticketId, ...o })) as Doc)
    const wf = workflowFor(ticket.workspace)
    if (opts.stage && !stageDef(wf, opts.stage)) return
    const run = loaded ? loaded.run : (((await payload.find({ collection: 'runs', where: { ticket: { equals: ticketId } }, sort: '-createdAt', limit: 1, ...o })).docs[0] as Doc | undefined) ?? null)
    const stage = stageDef(wf, opts.stage ?? ticket.stage ?? '')?.name ?? nameOf(wf, 'triage')
    const phase = opts.phase ?? phaseOf(wf, { ...ticket, stage }, run as RunRow, await gatesOf(payload, wf, { ...ticket, stage }))
    const key = `${stage}|${phase}`
    if (key === ticket.historyKey) return
    if (opts.cause === 'sweep' && phase === 'human') {
      const last = (await payload.find({ collection: 'ticket_events', where: { ticket: { equals: ticketId } }, sort: '-at', limit: 1, ...o })).docs[0] as Doc | undefined
      if (last?.stage === stage && String(last.cause).startsWith('gate:')) return
    }
    if (!(await cas(payload, ticketId, sql`"history_key" = ${key}`, sql`"history_key" IS DISTINCT FROM ${key}`))) return
    const live = run && run.stage === stage && ['running', 'queued', 'awaiting_session'].includes(run.status)
    await payload.create({
      collection: 'ticket_events',
      data: {
        ticket: ticketId,
        workspace: typeof ticket.workspace === 'object' ? ticket.workspace.id : ticket.workspace,
        at: new Date().toISOString(),
        stage,
        stageKind: kindOf(wf, stage) ?? null,
        phase,
        fromStage: String(ticket.historyKey ?? '').split('|')[0] || null,
        outcome: opts.outcome ?? null,
        note: opts.note || null,
        run: opts.run ?? (live ? run.id : null),
        executor: opts.executor ?? (phase === 'working' ? (run?.mode === 'session' ? 'session' : 'runner') : phase === 'human' ? 'human' : phase === 'ci' ? 'ci' : 'factory'),
        actor: opts.actor ?? (live ? run.sessionLabel ?? null : null),
        cause: opts.cause,
        workflowVersion: (await activeVersion(payload, typeof ticket.workspace === 'object' ? ticket.workspace.id : ticket.workspace))?.version ?? null,
      },
      ...o,
    })
    if (opts.cause !== 'sweep') await payload.jobs.queue({ task: 'sync-progress', queue: 'poll', input: { ticketId: Number(ticketId) } })
  } catch (e) {
    payload.logger.warn({ err: e, ticket: ticketId, cause: opts.cause }, 'recording ticket history failed')
  }
}

export const SKIP_CAUSE = 'skip:'

export const JOB_CAUSE = 'job:'

export const jobEvent = async (payload: Payload, ticket: Doc, e: { stage: string; job: string; what: 'queued' | 'finished'; run?: number | string; outcome?: string | null }): Promise<void> => {
  try {
    const wf = workflowFor(ticket.workspace)
    const ws = typeof ticket.workspace === 'object' ? ticket.workspace.id : ticket.workspace
    await payload.create({
      collection: 'ticket_events',
      data: { ticket: ticket.id, workspace: ws, at: new Date().toISOString(), stage: e.stage, stageKind: kindOf(wf, e.stage) ?? null, phase: e.what === 'queued' ? 'queued' : 'working', fromStage: e.stage, executor: 'factory', cause: `${JOB_CAUSE}${e.job}:${e.what}`, job: e.job, run: e.run ?? null, outcome: e.outcome ?? null, workflowVersion: (await activeVersion(payload, ws))?.version ?? null },
      ...o,
    })
  } catch (err) {
    payload.logger.warn({ err, ticket: ticket.id, job: e.job }, 'recording a job event failed')
  }
}

export const jobs = async (payload: Payload, ticketId: number | string): Promise<{ stage: string; job: string; what: 'queued' | 'finished'; at: string; run: number | null; outcome: string | null }[]> =>
  ((await payload.find({ collection: 'ticket_events', where: { and: [{ ticket: { equals: ticketId } }, { cause: { like: JOB_CAUSE } }] }, sort: ['at', 'id'], pagination: false, ...o })).docs as Doc[])
    .filter((e) => String(e.cause).startsWith(JOB_CAUSE))
    .map((e) => ({ stage: e.stage, job: e.job, what: String(e.cause).endsWith(':queued') ? 'queued' : 'finished', at: e.at, run: e.run ? (typeof e.run === 'object' ? e.run.id : e.run) : null, outcome: e.outcome ?? null }))

export const skipEvent = async (payload: Payload, ticket: Doc, sk: { stage: { name: string; kind: string }; reason: string }, opts: { from: string; by?: string; job?: string }): Promise<void> => {
  try {
    const cause = SKIP_CAUSE + sk.stage.name
    const last = (await payload.find({ collection: 'ticket_events', where: { ticket: { equals: ticket.id } }, sort: ['-at', '-id'], limit: 1, ...o })).docs[0] as Doc | undefined
    if (last?.cause === cause && last.note === sk.reason && (last.job ?? null) === (opts.job ?? null)) return
    const ws = typeof ticket.workspace === 'object' ? ticket.workspace.id : ticket.workspace
    await payload.create({
      collection: 'ticket_events',
      data: { ticket: ticket.id, workspace: ws, at: new Date().toISOString(), stage: sk.stage.name, stageKind: sk.stage.kind, phase: 'queued', fromStage: opts.from, executor: 'factory', actor: opts.by ?? null, cause, note: sk.reason, job: opts.job ?? null, workflowVersion: (await activeVersion(payload, ws))?.version ?? null },
      ...o,
    })
  } catch (e) {
    payload.logger.warn({ err: e, ticket: ticket.id }, 'recording a skipped step failed')
  }
}

export const skips = async (payload: Payload, ticketId: number | string): Promise<{ stage: string; at: string; reason: string; job: string | null }[]> =>
  ((await payload.find({ collection: 'ticket_events', where: { and: [{ ticket: { equals: ticketId } }, { cause: { like: SKIP_CAUSE } }] }, sort: ['at', 'id'], pagination: false, ...o })).docs as Doc[])
    .filter((e) => String(e.cause).startsWith(SKIP_CAUSE))
    .map((e) => ({ stage: e.stage, at: e.at, reason: e.note ?? '', job: e.job ?? null }))

export type Span = { id: number; at: string; until: string; seconds: number; stage: string | null; stageKind: string | null; phase: Phase; fromStage: string | null; outcome: string | null; run: number | null; executor: string | null; actor: string | null; cause: string | null; note: string | null; backfilled: boolean; workflowVersion: number | null; job?: string | null }

export const timeline = async (payload: Payload, ticketId: number | string): Promise<Span[]> => {
  const events = ((await payload.find({ collection: 'ticket_events', where: { ticket: { equals: ticketId } }, sort: ['at', 'id'], pagination: false, ...o })).docs as Doc[]).filter((e) => !String(e.cause).startsWith(SKIP_CAUSE) && !String(e.cause).startsWith(JOB_CAUSE))
  return events.map((e, i) => {
    const until = events[i + 1]?.at ?? (e.phase === 'closed' ? e.at : new Date().toISOString())
    return {
      id: e.id, at: e.at, until, seconds: (new Date(until).getTime() - new Date(e.at).getTime()) / 1000,
      stage: e.stage, stageKind: e.stageKind, phase: e.phase, fromStage: e.fromStage, outcome: e.outcome, run: e.run ? (typeof e.run === 'object' ? e.run.id : e.run) : null,
      executor: e.executor, actor: e.actor, cause: e.cause, note: e.note ?? null, backfilled: !!e.backfilled, workflowVersion: e.workflowVersion ?? null, job: e.job ?? null,
    }
  })
}

export type Flow = {
  tickets: { ticket: number; leadTimeSec: number | null; cycleTimeSec: number | null; stages: { stage: string; phase: Phase; seconds: number }[] }[]
  stages: { stage: string; tickets: number; phases: Partial<Record<Phase, { medianSec: number; p85Sec: number }>> }[]
  throughput: { week: string; tickets: number }[]
}

export const flow = async (payload: Payload, workspace: number | string, w: { from: string; to: string; product?: number | string }): Promise<Flow> => {
  const db = payload.db.drizzle
  const cohort = sql`
    WITH ev AS (
      SELECT e."ticket_id", e."stage", e."stage_kind", e."phase", e."at", LEAD(e."at") OVER (PARTITION BY e."ticket_id" ORDER BY e."at", e."id") AS "until"
      FROM "ticket_events" e JOIN "tickets" t ON t."id" = e."ticket_id"
      WHERE e."workspace_id" = ${workspace}::int AND COALESCE(e."cause", '') NOT LIKE ${SKIP_CAUSE + '%'} AND COALESCE(e."cause", '') NOT LIKE ${JOB_CAUSE + '%'} ${w.product == null ? sql`` : sql`AND t."product_id" = ${w.product}::int`}
    ), span AS (
      SELECT "ticket_id", "stage", "stage_kind", "phase", "at", EXTRACT(EPOCH FROM (COALESCE("until", CASE WHEN "phase" = 'closed' THEN "at" ELSE now() END) - "at"))::float8 AS "sec" FROM ev
    ), cohort AS (
      SELECT "ticket_id", min("at") AS "first_at", min("at") FILTER (WHERE "phase" = 'closed' OR "stage_kind" = 'done') AS "done_at", min("at") FILTER (WHERE "stage_kind" IS NOT NULL AND "stage_kind" <> 'triage') AS "work_at"
      FROM span GROUP BY "ticket_id" HAVING min("at") >= ${w.from}::timestamptz AND min("at") < ${w.to}::timestamptz
    ), per AS (
      SELECT s."ticket_id", s."stage", s."phase", sum(s."sec")::float8 AS "sec" FROM span s JOIN cohort c ON c."ticket_id" = s."ticket_id" GROUP BY s."ticket_id", s."stage", s."phase"
    )`
  const tickets = (await db.execute(sql`${cohort} SELECT "ticket_id", EXTRACT(EPOCH FROM ("done_at" - "first_at"))::float8 AS "lead", EXTRACT(EPOCH FROM ("done_at" - "work_at"))::float8 AS "cycle" FROM cohort ORDER BY "ticket_id"`)).rows as Doc[]
  const per = (await db.execute(sql`${cohort} SELECT "ticket_id", "stage", "phase", "sec" FROM per ORDER BY "ticket_id", "stage", "phase"`)).rows as Doc[]
  const agg = (await db.execute(sql`${cohort} SELECT "stage", "phase", count(*)::int AS "n", percentile_cont(0.5) WITHIN GROUP (ORDER BY "sec")::float8 AS "median", percentile_cont(0.85) WITHIN GROUP (ORDER BY "sec")::float8 AS "p85" FROM per GROUP BY "stage", "phase" ORDER BY "stage", "phase"`)).rows as Doc[]
  const count = (await db.execute(sql`${cohort} SELECT "stage", count(DISTINCT "ticket_id")::int AS "n" FROM per GROUP BY "stage"`)).rows as Doc[]
  const weeks = (await db.execute(sql`${cohort} SELECT to_char("done_at", 'IYYY-"W"IW') AS "week", count(*)::int AS "n" FROM cohort WHERE "done_at" IS NOT NULL GROUP BY 1 ORDER BY 1`)).rows as Doc[]
  const stages = new Map<string, Flow['stages'][number]>()
  for (const c of count) stages.set(c.stage, { stage: c.stage, tickets: c.n, phases: {} })
  for (const a of agg) stages.get(a.stage)!.phases[a.phase as Phase] = { medianSec: a.median, p85Sec: a.p85 }
  return {
    tickets: tickets.map((t) => ({ ticket: t.ticket_id, leadTimeSec: t.lead, cycleTimeSec: t.cycle != null && t.cycle >= 0 ? t.cycle : null, stages: per.filter((p) => p.ticket_id === t.ticket_id).map((p) => ({ stage: p.stage, phase: p.phase, seconds: p.sec })) })),
    stages: [...stages.values()],
    throughput: weeks.map((x) => ({ week: x.week, tickets: x.n })),
  }
}
