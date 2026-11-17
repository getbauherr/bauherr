import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { ACTIVE, reviewExtra, startRunIfNeeded } from '../jobs'
import { advance } from './advance'
import type { Finding, OpenItem } from './actions'
import { workflowFor } from './factory'
import { matches } from './glob'
import { jobEvent, SKIP_CAUSE, skipEvent } from './history'
import { cas } from './release'
import { factsOf } from './route'
import { OWN_VERDICT, jobOf, stage as stageDef } from './workflow'
import { evalWhen } from './workflow-when'

type Doc = Record<string, any>
const o = { depth: 0, overrideAccess: true } as const
const STOPPED = ['needs_human', 'failed', 'budget_exhausted']

/** The `job`, `kind` and `role` a Run of an explicit Job is created with; empty for a stage's own Job. */
export const jobExtra = (run: Doc): Record<string, unknown> => {
  if (!run.job) return {}
  const role = jobOf(stageDef(workflowFor(run.workspace), run.stage)!, run)?.role
  return { job: run.job, kind: 'agent', ...(role && { role }) }
}

/** The Run to show for a visit: of each Job's latest Run (`runs` newest first), one that stopped for a human, else the newest. */
export const worstRun = (runs: Doc[]): Doc | undefined => {
  const latest = [...new Map([...runs].reverse().map((r) => [r.job ?? null, r])).values()]
  return latest.find((r) => STOPPED.includes(r.status)) ?? runs[0]
}

const visitOf = async (payload: Payload, ticket: number | string, stage: string) => {
  const db = payload.db.drizzle
  const since = ((await db.execute(sql`SELECT "stage_since"::text AS since FROM "tickets" WHERE "id" = ${ticket}`)).rows[0] as { since: string | null }).since
  const runs = (await db.execute(sql`SELECT "id", "job", "status", "outcome" FROM "runs" WHERE "ticket_id" = ${ticket} AND "stage" = ${stage} AND (${since}::timestamptz IS NULL OR "created_at" >= ${since}::timestamptz) ORDER BY "id"`)).rows as { id: number; job: string | null; status: string; outcome: string | null }[]
  const skipped = new Set(((await db.execute(sql`SELECT "job" FROM "ticket_events" WHERE "ticket_id" = ${ticket} AND "cause" = ${SKIP_CAUSE + stage} AND "job" IS NOT NULL AND (${since}::timestamptz IS NULL OR "at" >= ${since}::timestamptz)`)).rows as { job: string }[]).map((r) => r.job))
  return { since, runs, skipped }
}

export const visitWorst = (t: Doc, runs: Doc[]): Doc | undefined => worstRun(runs.filter((r) => r.stage === t.stage && (!t.stageSince || r.createdAt >= t.stageSince)))

export type Candidates = { job: string; findings: Finding[]; open: OpenItem[]; truncated?: true }[]

export const MAX_CANDIDATE_BYTES = 50_000
const size = (v: unknown) => Buffer.byteLength(JSON.stringify(v))

const served = (job: string, found: Finding[], open: OpenItem[]): Candidates[number] => {
  const findings = found.map(({ test, ...f }) => (test ? { ...f, test: { command: test.command, failure: test.failure } } : f))
  if (size({ job, findings, open }) <= MAX_CANDIDATE_BYTES) return { job, findings, open }
  const kept = { job, findings: [] as Finding[], open: [] as OpenItem[], truncated: true as const }
  let used = size(kept)
  for (const [list, items] of [[kept.findings, findings], [kept.open, open]] as [unknown[], unknown[]][])
    for (const item of items) {
      used += size(item) + 1
      if (used > MAX_CANDIDATE_BYTES) return kept
      list.push(item)
    }
  return kept
}

/** The findings and open items of the latest succeeded Run of each Job `run` needs, in this visit of the stage; a review stage's Jobs report them, the Jobs that need them read them. */
export const candidatesOf = async (payload: Payload, t: Doc, run: Doc): Promise<Candidates> => {
  const def = stageDef(workflowFor(t.workspace), run.stage)
  const needs = (def && jobOf(def, run)?.needs) ?? []
  if (!needs.length) return []
  const { since } = await visitOf(payload, t.id, run.stage)
  const rows = (await payload.db.drizzle.execute(sql`SELECT DISTINCT ON ("job") "job", "findings", "artifacts"->'open' AS "open" FROM "runs" WHERE "ticket_id" = ${t.id} AND "stage" = ${run.stage} AND "status" = 'succeeded' AND "job" IN (${sql.join(needs.map((n) => sql`${n}`), sql`, `)}) AND (${since}::timestamptz IS NULL OR "created_at" >= ${since}::timestamptz) ORDER BY "job", "id" DESC`)).rows as { job: string; findings: Finding[] | null; open: OpenItem[] | null }[]
  return needs.flatMap((n) => rows.filter((r) => r.job === n).map((r) => served(n, r.findings ?? [], r.open ?? [])))
}

const closeAndAdvance = async (payload: Payload, t: Doc, to: string, claim: ReturnType<typeof sql>, by: { blocker?: Doc; run?: Doc; note?: string } = {}): Promise<void> => {
  const { blocker, note } = by
  const run = by.run ?? blocker
  const db = payload.db.drizzle
  const before = ((await db.execute(sql`SELECT "stage_since"::text AS since FROM "tickets" WHERE "id" = ${t.id}`)).rows[0] as { since: string | null }).since
  if (!(await cas(payload, t.id, sql`"stage_since" = now()`, claim))) return
  try {
    if (blocker) await db.execute(sql`UPDATE "runs" SET "status" = 'cancelled', "error" = ${`cancelled: ${blocker.job} reported ${blocker.outcome}`}, "finished_at" = now(), "lease_hash" = NULL, "session_owner_id" = NULL, "updated_at" = now() WHERE "ticket_id" = ${t.id} AND "stage" = ${blocker.stage} AND "id" <> ${blocker.id} AND "status" IN (${sql.join(ACTIVE.map((x) => sql`${x}`), sql`, `)})`)
    await advance(payload, null, t, to, { by: 'factory', ...(run && { run }), note })
  } catch (e) {
    await db.execute(sql`UPDATE "tickets" SET "stage_since" = ${before}::timestamptz WHERE "id" = ${t.id} AND "stage" = ${t.stage}`)
    throw e
  }
}

const blockedClaim = (stage: string, run: number) => sql`"stage" = ${stage} AND ("stage_since" IS NULL OR "stage_since" <= (SELECT "created_at" FROM "runs" WHERE "id" = ${run}))`

/** Whether a plan stage's extra Jobs (the agent Jobs besides its own Run, e.g. the agent-experience scan) are not all done in this visit; the plan cannot be approved or advance meanwhile. */
export const jobsOpen = async (payload: Payload, t: Doc): Promise<boolean> => {
  const def = stageDef(workflowFor(t.workspace), t.stage)
  if (def?.kind !== 'plan' || !def.jobs) return false
  const { runs, skipped } = await visitOf(payload, t.id, t.stage)
  return def.jobs.some((j) => j.id !== def.name && !skipped.has(j.id) && !runs.some((r) => r.job === j.id && r.status === 'succeeded' && r.outcome))
}

/**
 * Starts every Job of the Ticket's stage that is ready (all `needs` done or skipped, `when` matching) and has no Run in this visit; a Job whose `when` does not match is skipped and recorded.
 * A Job is done when its Run succeeded with an outcome that maps to `done`. A blocking Job whose recorded outcome maps to a stage outcome applies it (the recovery of a `finishJob` that did not finish).
 * When all Jobs are done the stage applies its first outcome; one conditional UPDATE of `stage_since` decides which concurrent caller advances.
 */
export const startReadyJobs = async (payload: Payload, ticket: Doc): Promise<boolean> => {
  const t = (await payload.findByID({ collection: 'tickets', id: ticket.id, ...o })) as Doc
  const def = stageDef(workflowFor(t.workspace), t.stage)
  if (!def?.jobs || def.kind === 'release' || t.state !== 'open') return false
  if (def.kind === 'review' && (t.reviewState || t.parked || t.waitingFor)) return false
  const { since, runs, skipped } = await visitOf(payload, t.id, t.stage)
  const own = def.kind === 'review' ? def.jobs.find((j) => j.id === def.name) : undefined
  const done = new Set<string>()
  let facts
  let started = false
  for (const j of def.jobs) {
    if (j === own) continue
    const mine = runs.filter((r) => (r.job ?? def.name) === j.id)
    if (j.id === def.name) {
      if (mine.some((r) => r.status === 'succeeded')) done.add(j.id)
      continue
    }
    const finished = mine.find((r) => r.status === 'succeeded' && r.outcome)
    const to = finished && j.outcomes[finished.outcome!]
    if (finished && j.blocking && to !== 'done') {
      const run = (await payload.findByID({ collection: 'runs', id: finished.id, ...o })) as Doc
      await closeAndAdvance(payload, t, to!, blockedClaim(t.stage, run.id), { blocker: run })
      return started
    }
    if (to === 'done' || finished || skipped.has(j.id)) done.add(j.id)
    else if (!mine.length && j.needs.every((n) => done.has(n))) {
      const verdict = j.when ? evalWhen(j.when, (facts ??= await factsOf(payload, t)), matches) : null
      if (verdict && !verdict.match) {
        await skipEvent(payload, t, { stage: def, reason: verdict.reason }, { from: t.stage, by: 'factory', job: j.id })
        done.add(j.id)
      } else {
        const queued = await startRunIfNeeded(payload, t as { id: number; workspace?: unknown }, t.stage, { job: j.id, kind: 'agent', role: j.role })
        if (queued.created) await jobEvent(payload, t, { stage: t.stage, job: j.id, what: 'queued', run: queued.run.id })
        started = true
      }
    }
  }
  if (own && own.needs.every((n) => done.has(n)) && !runs.some((r) => r.job === null)) {
    await startRunIfNeeded(payload, t as { id: number; workspace?: unknown }, t.stage, await reviewExtra(payload, t))
    started = true
  }
  if (OWN_VERDICT.includes(def.kind) || done.size < def.jobs.length) return started
  const last = runs.findLast((r) => r.status === 'succeeded')
  const claim = sql`"stage" = ${t.stage} AND "stage_since" IS NOT DISTINCT FROM ${since}::timestamptz`
  await closeAndAdvance(payload, t, def.outcomeOrder![0]!, claim, { run: last && ((await payload.findByID({ collection: 'runs', id: last.id, ...o })) as Doc) })
  return started
}

/**
 * The end of a Job Run that reported `outcome` (validated, recorded on the Run): a blocking Job whose outcome is not `done` applies the stage outcome it maps to now and cancels the other live Runs of the stage;
 * anything else only starts the Jobs that became ready. A Run of an earlier visit (the stage was already left) changes nothing.
 */
export const finishJob = async (payload: Payload, run: Doc, ticket: Doc, outcome: string, note?: string): Promise<void> => {
  const job = jobOf(stageDef(workflowFor(run.workspace), run.stage)!, run)!
  const to = job.outcomes[outcome]!
  await jobEvent(payload, ticket, { stage: run.stage, job: job.id, what: 'finished', run: run.id, outcome })
  if (!job.blocking || to === 'done') {
    await startReadyJobs(payload, ticket)
    return
  }
  await closeAndAdvance(payload, ticket, to, blockedClaim(run.stage, run.id), { blocker: { ...run, outcome }, note })
}
