import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { startRunIfNeeded } from '../jobs'
import { ESCALATION_MARKER, latestWith } from '../app/(app)/lib/plan'
import { sendBackToBuild, ticketsOf } from './actions'
import { budgetStatus } from './gateway'
import { baseCaps, escalatedCaps, REVIEW_CAP_REASON, startInvestigation } from './investigation'
import { modeFor } from './mode'
import { id } from './release'
import { tierModels } from './run-ctx'

type Doc = Record<string, any>
const o = { depth: 0, overrideAccess: true } as const

/** Rungs of the ladder: normal Run, strong retry, investigation, owner. */
export const LADDER_STEPS = 4

export type Next = 'retry-strong' | 'investigate' | 'owner'

/**
 * The next rung for a stopped Run. `prevFailed`: the Run it replaced (`previousRun`) had stopped too.
 * A `decision`/`access` reason goes straight to the owner; a Run that was already strong (escalated, or the second failure in a row) goes to an investigation (Build only), then to the owner.
 */
export const nextStep = (run: Doc, prevFailed: boolean): Next => {
  if (run.reasonKind === 'decision' || run.reasonKind === 'access') return 'owner'
  if (run.investigation) return prevFailed ? 'owner' : 'retry-strong'
  return prevFailed || run.escalation ? (run.stage === 'build' ? 'investigate' : 'owner') : 'retry-strong'
}

const cost = (r: Doc): string => {
  const c = r.costUsd ?? r.costEstimateUsd
  return c == null ? 'cost not recorded' : `$${Number(c).toFixed(2)}`
}

/** Appends one line to the Ticket's one escalation Comment (created on first use); a line whose key is already there is skipped, so a retry never doubles it. */
const note = async (payload: Payload, t: Doc, key: string, line: string): Promise<void> => {
  const ts = await ticketsOf(payload, id(t.product))
  const n = String(t.number)
  const existing = latestWith(await ts.listComments(n), ESCALATION_MARKER)
  if (existing?.body.includes(key)) return
  if (existing) await ts.updateComment(n, existing.id, `${existing.body}\n${line}`)
  else await ts.comment(n, `${ESCALATION_MARKER}\n# Escalations\n\n${line}`)
}

/** The tier-`strong` model of the Workspace, for the Comment line; sessions use their own strongest model. */
const strongModel = async (payload: Payload, t: Doc, mode: string): Promise<string> => {
  if (mode === 'session') return 'the session\'s strongest model'
  try {
    return (await tierModels(payload, (await payload.findByID({ collection: 'workspaces', id: id(t.workspace), ...o })) as Doc)).strong ?? 'strong'
  } catch {
    return 'strong'
  }
}

/** Whether the Workspace's USD budget is spent. Token budgets and an unreachable gateway do not block (no spend source). */
export const budgetOut = async (payload: Payload, workspace: number | string): Promise<boolean> => {
  const ws = (await payload.findByID({ collection: 'workspaces', id: workspace, ...o })) as Doc
  if (ws.budgetUnit === 'tokens' || !process.env.GATEWAY_DATABASE_URL) return false
  const s = await budgetStatus(ws.slug).catch(() => null)
  return !!s && s.limitUsd != null && s.spentUsd >= s.limitUsd
}

const previousStopped = async (payload: Payload, run: Doc): Promise<Doc | null> => {
  if (!run.previousRun) return null
  const prev = (await payload.findByID({ collection: 'runs', id: id(run.previousRun), ...o }).catch(() => null)) as Doc | null
  return prev && prev.stage === run.stage && ['failed', 'abandoned', 'needs_human'].includes(prev.status) ? prev : null
}

/** The ladder ended: the Run's `reasonKind` makes it a need for the owner; the Comment line names the history and the reason. Returns false. */
const toOwner = async (payload: Payload, t: Doc, run: Doc, why: string): Promise<false> => {
  const kind = why === 'budget' ? 'access' : run.reasonKind === 'access' ? 'access' : 'decision'
  await note(payload, t, `Run #${run.id} to the owner`, `- Step ${LADDER_STEPS} of ${LADDER_STEPS}: Run #${run.id} to the owner (${why}). ${run.stage} Run #${run.id} ${run.status} (${cost(run)}).`)
  if (run.reasonKind !== kind) await payload.update({ collection: 'runs', id: run.id, data: { reasonKind: kind }, overrideAccess: true })
  return false
}

/** The step-2 line for the Run a strong retry replaced; skipped when it is already in the Comment. */
export const noteRetry = async (payload: Payload, t: Doc, stopped: Doc, reason: string): Promise<void> => {
  const mode = await modeFor(payload, id(t.workspace), stopped.stage)
  const caps = escalatedCaps(stopped.stage, baseCaps(stopped.stage))
  const key = `after ${stopped.stage} Run #${stopped.id} (`
  await note(payload, t, key, `- Step 2 of ${LADDER_STEPS} ${key}${stopped.status}, ${cost(stopped)}): ${reason.split('\n')[0]!.slice(0, 300)}. Retry on strong (${await strongModel(payload, t, mode)}), ${caps.maxTurns} turns, $${caps.maxBudgetUsd}.`)
}

/** Writes the step-2 line of live strong retries whose line is missing (an abandoned session Run's successor is created in SQL, a forge error can lose the line). Returns how many it wrote. */
export const resumeEscalationNotes = async (payload: Payload): Promise<number> => {
  const live = (await payload.find({ collection: 'runs', where: { and: [{ status: { in: ['queued', 'awaiting_session', 'running'] } }, { escalation: { exists: true } }, { previousRun: { exists: true } }] }, pagination: false, ...o })).docs as Doc[]
  let n = 0
  for (const run of live.filter((r) => r.escalation?.step === 2 && r.escalation.reason !== REVIEW_CAP_REASON && !String(r.escalation.reason).startsWith('invalid review output'))) {
    try {
      const stopped = (await payload.findByID({ collection: 'runs', id: id(run.previousRun), ...o })) as Doc
      const t = (await payload.findByID({ collection: 'tickets', id: id(run.ticket), ...o })) as Doc
      const before = latestWith(await (await ticketsOf(payload, id(t.product))).listComments(String(t.number)), ESCALATION_MARKER)?.body ?? ''
      await noteRetry(payload, t, stopped, String(run.escalation.reason))
      const after = latestWith(await (await ticketsOf(payload, id(t.product))).listComments(String(t.number)), ESCALATION_MARKER)?.body ?? ''
      if (after !== before) n++
    } catch (e) {
      payload.logger.warn({ err: e, run: run.id }, 'resuming the escalation note failed')
    }
  }
  return n
}

/**
 * One rung up the ladder for a stopped Run (failed, abandoned or `needs_human` + `stuck`): a strong retry with doubled caps, an investigation (Build, after a strong Run failed) or the owner.
 * Returns what it started, or false when the ladder ended at the owner (budget out, no rung left, or a human-only reason).
 * Retry-safe: the Comment line is keyed by the stopped Run and written before the Run, which `startRunIfNeeded` creates atomically with its `escalation`.
 */
export const escalate = async (payload: Payload, t: Doc, run: Doc, reason: string): Promise<string | false> => {
  const prev = await previousStopped(payload, run)
  const step = nextStep(run, !!prev)
  if (step === 'owner') return toOwner(payload, t, run, run.reasonKind ?? 'no rung left')
  const mode = await modeFor(payload, id(t.workspace), run.stage)
  if (mode === 'autonomous' && (await budgetOut(payload, id(t.workspace)))) return toOwner(payload, t, run, 'budget')
  const key = `after ${run.stage} Run #${run.id} (`
  const stopped = `${key}${run.status}, ${cost(run)}): ${reason.split('\n')[0]!.slice(0, 300)}`
  const model = await strongModel(payload, t, mode)
  if (step === 'investigate') {
    await note(payload, t, key, `- Step 3 of ${LADDER_STEPS} ${stopped}. Investigation on strong (${model}), 60 turns, $2.`)
    return (await startInvestigation(payload, t, prev ? [prev, run] : [run])) ? 'Failed twice: back to Plan for investigation.' : toOwner(payload, t, run, 'no investigation left')
  }
  await noteRetry(payload, t, run, reason)
  const extra = run.investigation ? { investigation: run.investigation } : { escalation: { step: 2, reason: reason.split('\n')[0]!.slice(0, 300), previousRuns: [run.id] } }
  const { created } = await startRunIfNeeded(payload, t as { id: number; workspace?: unknown }, run.stage, { previousRun: run.id, ...extra })
  return created ? `Started one new ${run.stage} Run on strong.` : false
}

/**
 * A Ticket at the review round cap gets one more fix round with Build and Review on strong; the Build Run's `escalation.reason` marks it used, so a second cap goes to the owner.
 * Returns what it did, or false when the owner decides (the strong round was used, or the budget is out).
 */
export const escalateReviewCap = async (payload: Payload, t: Doc): Promise<string | false> => {
  const builds = (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: t.id } }, { stage: { equals: 'build' } }] }, pagination: false, ...o })).docs as Doc[]
  if (builds.some((r) => r.escalation?.reason === REVIEW_CAP_REASON)) return false
  const mode = await modeFor(payload, id(t.workspace), 'build')
  const key = 'after the review round cap'
  if (mode === 'autonomous' && (await budgetOut(payload, id(t.workspace)))) {
    await note(payload, t, key, `- Step ${LADDER_STEPS} of ${LADDER_STEPS} ${key}: to the owner (budget).`)
    return false
  }
  const caps = escalatedCaps('build', baseCaps('build'))
  await note(payload, t, key, `- Step 2 of ${LADDER_STEPS} ${key}: one more fix round, Build and Review on strong (${await strongModel(payload, t, mode)}), ${caps.maxTurns} turns, $${caps.maxBudgetUsd}.`)
  const found = latestWith(await (await ticketsOf(payload, id(t.product))).listComments(String(t.number)), 'Bauherr needs a human:')?.body
  const out = await sendBackToBuild(payload, t, `${found ?? 'Bauherr needs a human: the review round cap was reached.'}\nThe factory granted one more round on the strong tier.`, { step: 2, reason: REVIEW_CAP_REASON, previousRuns: [] })
  return out === 'build' ? 'Round cap: one more fix round on strong.' : false
}

/** A review whose output was rejected as invalid (`problem`) parked the Ticket `ready_for_human`: the successor review runs on strong, once. */
export const escalateInvalidReview = async (payload: Payload, t: Doc, run: Doc): Promise<string | false> => {
  const mode = await modeFor(payload, id(t.workspace), 'review')
  const key = `after review Run #${run.id} (`
  if (mode === 'autonomous' && (await budgetOut(payload, id(t.workspace)))) {
    await note(payload, t, key, `- Step ${LADDER_STEPS} of ${LADDER_STEPS} ${key}invalid output): to the owner (budget).`)
    return false
  }
  const problem = String(run.artifacts?.review?.problem ?? 'invalid output').slice(0, 300)
  await note(payload, t, key, `- Step 2 of ${LADDER_STEPS} ${key}invalid output): ${problem}. Review again on strong (${await strongModel(payload, t, mode)}), ${escalatedCaps('review', baseCaps('review')).maxTurns} turns, $${escalatedCaps('review', baseCaps('review')).maxBudgetUsd}.`)
  await payload.db.drizzle.execute(sql`UPDATE "tickets" SET "review_state" = NULL, "review_waiting_since" = NULL, "updated_at" = now() WHERE "id" = ${t.id} AND "stage" = 'review' AND "review_state" = 'ready_for_human'`)
  const { created } = await startRunIfNeeded(payload, t as { id: number; workspace?: unknown }, 'review', { previousRun: run.id, escalation: { step: 2, reason: `invalid review output: ${problem}`, previousRuns: [run.id] } })
  return created ? 'The review output was invalid; reviewing again on strong.' : false
}
