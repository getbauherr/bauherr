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

/** Where a Ticket's time goes right now. First match: closed; a live Run (running = working, queued or awaiting a session = queued); needs the owner = human; waiting on checks, the merge queue or a deploy = ci; else queued. */
export const phaseOf = (wf: Workflow, t: Doc, run: RunRow, gates?: Parameters<typeof needsOf>[4]): Phase => {
  const stage = t.stage ?? nameOf(wf, 'triage')
  if (t.state === 'closed' || is(wf, stage, 'done')) return 'closed'
  // Only a Run of the Ticket's own stage is its work: a Build Run still ending while the Ticket already sits in review is not.
  if (run && run.stage === stage && run.status === 'running') return 'working'
  if (run && run.stage === stage && (run.status === 'queued' || run.status === 'awaiting_session')) return 'queued'
  if (needsOf(wf, { ...t, stage }, run, false, gates)) return 'human'
  const at = (...k: Kind[]) => is(wf, stage, ...k)
  if (t.waitingFor === 'checks' || (at('review') && ['waiting_checks', 'queued'].includes(t.reviewState)) || (at('release') && (t.releaseState === 'waiting' || t.productionState === 'deploying')) || t.releaseChecksState === 'waiting') return 'ci'
  return 'queued'
}

type Opts = { cause: string; outcome?: string; run?: number | string; actor?: string; executor?: Executor; stage?: string; phase?: Phase }

/**
 * Appends a `ticket_events` row when the Ticket's `stage|phase` changed; never throws (history must not break the workflow).
 * `stage` and `phase` override what the Ticket row says, for callers that run just before the row is written. `loaded` spares the reads of a caller that has the rows.
 * One conditional UPDATE of `tickets.history_key` decides which of several concurrent callers records the change.
 */
export const record = async (payload: Payload, ticketId: number | string, opts: Opts, loaded?: { ticket: Doc; run: Doc | null }): Promise<void> => {
  try {
    if (opts.stage && !loaded && ['scan', 'distill'].includes(opts.stage)) return
    const ticket = loaded?.ticket ?? ((await payload.findByID({ collection: 'tickets', id: ticketId, ...o })) as Doc)
    const wf = workflowFor(ticket.workspace)
    if (opts.stage && !stageDef(wf, opts.stage)) return
    const run = loaded ? loaded.run : (((await payload.find({ collection: 'runs', where: { ticket: { equals: ticketId } }, sort: '-createdAt', limit: 1, ...o })).docs[0] as Doc | undefined) ?? null)
    const stage = stageDef(wf, opts.stage ?? ticket.stage ?? '')?.name ?? nameOf(wf, 'triage')
    const phase = opts.phase ?? phaseOf(wf, { ...ticket, stage }, run as RunRow, await gatesOf(payload, wf, { ...ticket, stage }))
    const key = `${stage}|${phase}`
    if (key === ticket.historyKey) return
    // A sweep right after a gate action still sees the old labels: it must not turn the Ticket back to "waiting for a human".
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
        run: opts.run ?? (live ? run.id : null),
        executor: opts.executor ?? (phase === 'working' ? (run?.mode === 'session' ? 'session' : 'runner') : phase === 'human' ? 'human' : phase === 'ci' ? 'ci' : 'factory'),
        actor: opts.actor ?? (live ? run.sessionLabel ?? null : null),
        cause: opts.cause,
        workflowVersion: (await activeVersion(payload, typeof ticket.workspace === 'object' ? ticket.workspace.id : ticket.workspace))?.version ?? null,
      },
      ...o,
    })
    // The sweep (`notify-gates`) handles its own transitions in the same pass; every other cause queues the Comment update so no request path waits for the forge.
    if (opts.cause !== 'sweep') await payload.jobs.queue({ task: 'sync-progress', queue: 'poll', input: { ticketId: Number(ticketId) } })
  } catch (e) {
    payload.logger.warn({ err: e, ticket: ticketId, cause: opts.cause }, 'recording ticket history failed')
  }
}

/** The cause of an event that only notes a skipped conditional step: it is no visit of that stage, takes no time and is left out of the spans and the flow metrics. */
export const SKIP_CAUSE = 'skip:'

/** Notes that a Ticket passed a conditional step without entering it (`reason` in plain words); never throws. */
export const skipEvent = async (payload: Payload, ticket: Doc, sk: { stage: { name: string; kind: string }; reason: string }, opts: { from: string; by?: string }): Promise<void> => {
  try {
    const cause = SKIP_CAUSE + sk.stage.name
    const last = (await payload.find({ collection: 'ticket_events', where: { ticket: { equals: ticket.id } }, sort: ['-at', '-id'], limit: 1, ...o })).docs[0] as Doc | undefined
    if (last?.cause === cause && last.note === sk.reason) return
    const ws = typeof ticket.workspace === 'object' ? ticket.workspace.id : ticket.workspace
    await payload.create({
      collection: 'ticket_events',
      data: { ticket: ticket.id, workspace: ws, at: new Date().toISOString(), stage: sk.stage.name, stageKind: sk.stage.kind, phase: 'queued', fromStage: opts.from, executor: 'factory', actor: opts.by ?? null, cause, note: sk.reason, workflowVersion: (await activeVersion(payload, ws))?.version ?? null },
      ...o,
    })
  } catch (e) {
    payload.logger.warn({ err: e, ticket: ticket.id }, 'recording a skipped step failed')
  }
}

/** The conditional steps the Ticket passed without entering, in order: `{ stage, at, reason }`. */
export const skips = async (payload: Payload, ticketId: number | string): Promise<{ stage: string; at: string; reason: string }[]> =>
  ((await payload.find({ collection: 'ticket_events', where: { and: [{ ticket: { equals: ticketId } }, { cause: { like: SKIP_CAUSE } }] }, sort: ['at', 'id'], pagination: false, ...o })).docs as Doc[])
    .filter((e) => String(e.cause).startsWith(SKIP_CAUSE))
    .map((e) => ({ stage: e.stage, at: e.at, reason: e.note ?? '' }))

export type Span = { id: number; at: string; until: string; seconds: number; stage: string | null; stageKind: string | null; phase: Phase; fromStage: string | null; outcome: string | null; run: number | null; executor: string | null; actor: string | null; cause: string | null; backfilled: boolean; workflowVersion: number | null }

/** The Ticket's events in order; `until` is the next event's `at` (now for the newest, which is its own `at` once closed). */
export const timeline = async (payload: Payload, ticketId: number | string): Promise<Span[]> => {
  const events = ((await payload.find({ collection: 'ticket_events', where: { ticket: { equals: ticketId } }, sort: ['at', 'id'], pagination: false, ...o })).docs as Doc[]).filter((e) => !String(e.cause).startsWith(SKIP_CAUSE))
  return events.map((e, i) => {
    const until = events[i + 1]?.at ?? (e.phase === 'closed' ? e.at : new Date().toISOString())
    return {
      id: e.id, at: e.at, until, seconds: (new Date(until).getTime() - new Date(e.at).getTime()) / 1000,
      stage: e.stage, stageKind: e.stageKind, phase: e.phase, fromStage: e.fromStage, outcome: e.outcome, run: e.run ? (typeof e.run === 'object' ? e.run.id : e.run) : null,
      executor: e.executor, actor: e.actor, cause: e.cause, backfilled: !!e.backfilled, workflowVersion: e.workflowVersion ?? null,
    }
  })
}

export type Flow = {
  tickets: { ticket: number; leadTimeSec: number | null; cycleTimeSec: number | null; stages: { stage: string; phase: Phase; seconds: number }[] }[]
  stages: { stage: string; tickets: number; phases: Partial<Record<Phase, { medianSec: number; p85Sec: number }>> }[]
  throughput: { week: string; tickets: number }[]
}

/**
 * Flow metrics of the Tickets whose first event falls in [from, to): lead time = first event to the first closed/done event, cycle time = the first event outside the triage stage to done,
 * seconds per stage and phase, median and p85 of those per stage and phase, and the Tickets reaching done per ISO week. A span ends at the next event (now while open).
 */
export const flow = async (payload: Payload, workspace: number | string, w: { from: string; to: string; product?: number | string }): Promise<Flow> => {
  const db = payload.db.drizzle
  const cohort = sql`
    WITH ev AS (
      SELECT e."ticket_id", e."stage", e."stage_kind", e."phase", e."at", LEAD(e."at") OVER (PARTITION BY e."ticket_id" ORDER BY e."at", e."id") AS "until"
      FROM "ticket_events" e JOIN "tickets" t ON t."id" = e."ticket_id"
      WHERE e."workspace_id" = ${workspace}::int AND COALESCE(e."cause", '') NOT LIKE ${SKIP_CAUSE + '%'} ${w.product == null ? sql`` : sql`AND t."product_id" = ${w.product}::int`}
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
