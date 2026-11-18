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
import { jobExtra } from './stage-jobs'
import { kindOfRun } from './stage-text'
import { workflowFor } from './factory'
import { nameOf } from './workflow'

type Doc = Record<string, any>
const o = { depth: 0, overrideAccess: true } as const

export const LADDER_STEPS = 4

export type Next = 'retry-strong' | 'investigate' | 'owner'

export const nextStep = (run: Doc, prevFailed: boolean): Next => {
  if (run.reasonKind === 'decision' || run.reasonKind === 'access' || run.stage === 'scan' || run.stage === 'docs') return 'owner'
  if (run.investigation) return prevFailed ? 'owner' : 'retry-strong'
  return prevFailed || run.escalation ? (kindOfRun(workflowFor(run.workspace), run) === 'build' ? 'investigate' : 'owner') : 'retry-strong'
}

const cost = (r: Doc): string => {
  const c = r.costUsd ?? r.costEstimateUsd
  return c == null ? 'cost not recorded' : `$${Number(c).toFixed(2)}`
}

const note = async (payload: Payload, t: Doc, key: string, line: string): Promise<void> => {
  const ts = await ticketsOf(payload, id(t.product))
  const n = String(t.number)
  const existing = latestWith(await ts.listComments(n), ESCALATION_MARKER)
  if (existing?.body.includes(key)) return
  if (existing) await ts.updateComment(n, existing.id, `${existing.body}\n${line}`)
  else await ts.comment(n, `${ESCALATION_MARKER}\n# Escalations\n\n${line}`)
}

const strongModel = async (payload: Payload, t: Doc, mode: string): Promise<string> => {
  if (mode === 'session') return 'the session\'s strongest model'
  try {
    return (await tierModels(payload, (await payload.findByID({ collection: 'workspaces', id: id(t.workspace), ...o })) as Doc)).strong ?? 'strong'
  } catch {
    return 'strong'
  }
}

export const budgetOut = async (payload: Payload, workspace: number | string): Promise<boolean> => {
  const ws = (await payload.findByID({ collection: 'workspaces', id: workspace, ...o })) as Doc
  if (ws.budgetUnit === 'tokens' || !process.env.GATEWAY_DATABASE_URL) return false
  const s = await budgetStatus(ws.slug).catch(() => null)
  return !!s && s.limitUsd != null && s.spentUsd >= s.limitUsd
}

const previousStopped = async (payload: Payload, run: Doc): Promise<Doc | null> => {
  if (!run.previousRun) return null
  const prev = (await payload.findByID({ collection: 'runs', id: id(run.previousRun), ...o }).catch(() => null)) as Doc | null
  return prev && prev.stage === run.stage && prev.reasonKind !== 'preempted' && ['failed', 'abandoned', 'needs_human'].includes(prev.status) ? prev : null
}

const toOwner = async (payload: Payload, t: Doc, run: Doc, why: string): Promise<false> => {
  const kind = why === 'budget' ? 'access' : run.reasonKind === 'access' ? 'access' : 'decision'
  await note(payload, t, `Run #${run.id} to the owner`, `- Step ${LADDER_STEPS} of ${LADDER_STEPS}: Run #${run.id} to the owner (${why}). ${run.stage} Run #${run.id} ${run.status} (${cost(run)}).`)
  if (run.reasonKind !== kind) await payload.update({ collection: 'runs', id: run.id, data: { reasonKind: kind }, overrideAccess: true })
  return false
}

export const noteRetry = async (payload: Payload, t: Doc, stopped: Doc, reason: string): Promise<void> => {
  const mode = await modeFor(payload, id(t.workspace), stopped.stage)
  const kind = kindOfRun(workflowFor(t.workspace), stopped)
  const caps = escalatedCaps(kind, baseCaps(kind))
  const key = `after ${stopped.stage} Run #${stopped.id} (`
  await note(payload, t, key, `- Step 2 of ${LADDER_STEPS} ${key}${stopped.status}, ${cost(stopped)}): ${reason.split('\n')[0]!.slice(0, 300)}. Retry on strong (${await strongModel(payload, t, mode)}), ${caps.maxTurns} turns, $${caps.maxBudgetUsd}.`)
}

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

export const escalate = async (payload: Payload, t: Doc, run: Doc, reason: string): Promise<string | false> => {
  if (run.reasonKind === 'preempted') return false
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
  const { created } = await startRunIfNeeded(payload, t as { id: number; workspace?: unknown }, run.stage, { previousRun: run.id, ...extra, ...jobExtra(run) })
  return created ? `Started one new ${run.stage} Run on strong.` : false
}

export const escalateReviewCap = async (payload: Payload, t: Doc): Promise<string | false> => {
  const builds = (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: t.id } }, { kind: { equals: 'build' } }] }, pagination: false, ...o })).docs as Doc[]
  if (builds.some((r) => r.escalation?.reason === REVIEW_CAP_REASON)) return false
  const mode = await modeFor(payload, id(t.workspace), nameOf(workflowFor(t.workspace), 'build'))
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

export const escalateInvalidReview = async (payload: Payload, t: Doc, run: Doc): Promise<string | false> => {
  const wf = workflowFor(t.workspace)
  const review = nameOf(wf, 'review')
  const mode = await modeFor(payload, id(t.workspace), review)
  const key = `after review Run #${run.id} (`
  if (mode === 'autonomous' && (await budgetOut(payload, id(t.workspace)))) {
    await note(payload, t, key, `- Step ${LADDER_STEPS} of ${LADDER_STEPS} ${key}invalid output): to the owner (budget).`)
    return false
  }
  const problem = String(run.artifacts?.review?.problem ?? 'invalid output').slice(0, 300)
  await note(payload, t, key, `- Step 2 of ${LADDER_STEPS} ${key}invalid output): ${problem}. Review again on strong (${await strongModel(payload, t, mode)}), ${escalatedCaps('review', baseCaps('review')).maxTurns} turns, $${escalatedCaps('review', baseCaps('review')).maxBudgetUsd}.`)
  await payload.db.drizzle.execute(sql`UPDATE "tickets" SET "review_state" = NULL, "review_waiting_since" = NULL, "updated_at" = now() WHERE "id" = ${t.id} AND "stage" = ${review} AND "review_state" = 'ready_for_human'`)
  const { created } = await startRunIfNeeded(payload, t as { id: number; workspace?: unknown }, review, { previousRun: run.id, escalation: { step: 2, reason: `invalid review output: ${problem}`, previousRuns: [run.id] } })
  return created ? 'The review output was invalid; reviewing again on strong.' : false
}
