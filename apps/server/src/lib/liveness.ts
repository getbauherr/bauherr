import { live } from './workspace-delete'
import { sql } from '@payloadcms/db-postgres'
import type { Payload, Where } from 'payload'
import { ACTIVE, startReviewIfReady, triageable } from '../jobs'
import { sendBackToBuild, ticketsOf } from './actions'
import { escalate, escalateInvalidReview, escalateReviewCap, resumeEscalationNotes } from './escalation'
import { resumeInvestigations } from './investigation'
import { MAX_REVIEW_ROUNDS, type Need, needsYou } from './needs-you'
import { kindOfRun } from './stage-text'
import { workflowFor } from './factory'
import { visitWorst } from './stage-jobs'
import { is, liveStages, nameOf, stage as stageDef } from './workflow'
import { laneWaiter } from './expedite'
import { forgeOf, id, isFactoryPr, mergeChecks, prOf } from './release'

type Doc = Record<string, any>
const o = { depth: 0, overrideAccess: true } as const

export const CAUSES = ['triage-expired', 'mr-missing', 'checks-red', 'run-failed', 'run-cancelled', 'run-abandoned', 'run-stuck', 'review-escalated', 'review-invalid', 'review-stalled', 'fast-lane-held', 'unknown'] as const
export type Cause = (typeof CAUSES)[number]
export const REPAIRED: readonly Cause[] = ['triage-expired', 'mr-missing', 'checks-red', 'run-failed', 'run-abandoned', 'run-stuck', 'review-escalated', 'review-invalid']
export const AGENT_REPAIRED: readonly Cause[] = ['mr-missing', 'checks-red']

export const AGENT_RELEASED: readonly Cause[] = ['fast-lane-held']

export type Dead = { ticket: Doc; cause: Cause; run: Doc | null; need: Need | null; since?: string }

const REVIEW_STALLED_MS = 30 * 60_000
const LANE_HELD_MS = 30 * 60_000


const replacementMr = async (payload: Payload, t: Doc) => {
  const { backend, repo } = await forgeOf(payload, id(t.product))
  return (await backend.forge.listPullRequests(repo, 'open')).filter((pr) => isFactoryPr(pr, repo, t) && pr.state === 'open').sort((a, b) => b.number - a.number)[0] ?? null
}

const causeOf = async (payload: Payload, t: Doc, latest: Doc | null): Promise<Cause | null> => {
  const wf = workflowFor(t.workspace)
  const latestIs = (kind: string) => !!latest && kindOfRun(wf, latest) === kind
  if (!t.stage) {
    const covered = t.triagedAt && t.sourceUpdatedAt && new Date(t.triagedAt).getTime() >= new Date(t.sourceUpdatedAt).getTime()
    return covered && !t.mergeSha && triageable(wf, { state: t.state, labels: t.labels ?? [], assignee: t.assignee }) && latestIs('triage') && latest?.status === 'abandoned' ? 'triage-expired' : null
  }
  if (is(wf, t.stage, 'review')) {
    if (t.reviewState === 'merged') return null
    if (t.reviewState === 'ready_for_human') {
      if (latestIs('review') && latest?.status === 'succeeded' && latest.artifacts?.review?.problem) return !latest.escalation ? 'review-invalid' : null
      if (!t.reviewWaitingSince || Date.now() - Date.parse(t.reviewWaitingSince) <= REVIEW_STALLED_MS) return null
      const touches = (await payload.find({ collection: 'human_touches', where: { and: [{ ticket: { equals: t.id } }, { at: { greater_than: t.reviewWaitingSince } }] }, pagination: false, ...o })).docs as Doc[]
      return touches.some((h) => h.actor !== 'factory') ? null : 'review-stalled'
    }
    try {
      const mr = await prOf(payload, t, { fallback: false })
      if (!mr || mr.pr.state === 'closed') return 'mr-missing'
      if (mr.pr.state === 'merged') return null
      if (t.reviewState !== 'needs_human') return !t.reviewState && (latestIs('review') || (latest?.job && latest.stage === t.stage)) ? runEnd(latest as Doc) : null
      if ((t.reviewRounds ?? 0) > MAX_REVIEW_ROUNDS) return 'review-escalated'
      return mergeChecks(await mr.backend.forge.listChecks(mr.repo, mr.pr.headSha)).state === 'red' ? 'checks-red' : 'review-escalated'
    } catch {
      return null
    }
  }
  return latest && latest.stage === t.stage ? runEnd(latest) : null
}

const runEnd = (latest: Doc): Cause | null => {
  if (latest.status === 'needs_human') return latest.reasonKind === 'stuck' ? 'run-stuck' : null
  return ({ failed: 'run-failed', cancelled: 'run-cancelled', abandoned: 'run-abandoned' } as const)[latest.status as 'failed'] ?? null
}

export const deadTickets = async (payload: Payload, workspace?: number | string): Promise<Dead[]> => {
  const workspaces = workspace === undefined ? (await payload.find({ collection: 'workspaces', where: live, select: {}, pagination: false, ...o })).docs.map((w) => w.id) : [workspace]
  const byWorkspace: Where[] = workspaces.map((w) => ({ and: [{ workspace: { equals: w } }, { or: [{ stage: { in: [...liveStages(workflowFor(w)), ...workflowFor(w).stages.filter((s) => s.jobs).map((s) => s.name)] } }, { stage: { exists: false } }] }] as Where[] }))
  const where: Where = { and: [{ state: { equals: 'open' } }, { or: byWorkspace }] }
  const tickets = ((await payload.find({ collection: 'tickets', where, pagination: false, ...o })).docs as Doc[]).filter((t) => !t.parked && !t.waitingFor && !(t.blockedBy?.length ?? 0))
  if (!tickets.length) return []
  const runs = (await payload.find({ collection: 'runs', where: { ticket: { in: tickets.map((t) => t.id) } }, sort: '-createdAt', pagination: false, ...o })).docs as Doc[]
  const dead: Dead[] = []
  for (const t of tickets) {
    const mine = runs.filter((r) => id(r.ticket) === t.id)
    if (mine.some((r) => ACTIVE.includes(r.status))) continue
    const latest = (stageDef(workflowFor(t.workspace), t.stage)?.jobs ? visitWorst(t, mine) : mine[0]) ?? null
    let cause = (await causeOf(payload, t, latest)) ?? (latest && latest.stage === t.stage && ['failed', 'abandoned', 'cancelled', 'needs_human'].includes(latest.status) ? 'unknown' : null)
    if (!cause) continue
    const held = cause === 'review-stalled' && (await laneWaiter(payload, t))
    if (held) cause = 'fast-lane-held'
    const since = held ? (t.liveness?.cause === cause && t.liveness.since) || new Date().toISOString() : undefined
    const laneHeld = !!since && Date.now() - Date.parse(since) > LANE_HELD_MS
    const need = needsYou(workflowFor(t.workspace), { stage: t.stage, labels: t.labels ?? [], releaseState: t.releaseState, productionState: t.productionState, releaseChecksState: t.releaseChecksState, reviewState: t.reviewState, reviewRounds: t.reviewRounds, expedite: t.expedite, waitingFor: t.waitingFor, laneHeld }, latest && { stage: latest.stage, status: latest.status, reasonKind: latest.reasonKind })
    dead.push({ ticket: t, cause, run: latest, need, since })
  }
  return dead
}

const markerOf = (d: Dead): string => `<!-- bauherr:liveness:${d.cause}:${d.run?.id ?? 'none'} -->`

const repaired = async (payload: Payload, d: Dead): Promise<boolean> =>
  (await (await ticketsOf(payload, id(d.ticket.product))).listComments(String(d.ticket.number))).some((c) => c.body.startsWith(markerOf(d)))

const record = async (payload: Payload, d: Dead, what: string): Promise<true> => {
  await (await ticketsOf(payload, id(d.ticket.product))).comment(String(d.ticket.number), `${markerOf(d)}\nBauherr liveness: ${d.cause}. ${what}`)
  return true
}

export const repair = async (payload: Payload, d: Dead): Promise<boolean> => {
  const t = d.ticket
  const wf = workflowFor(t.workspace)
  if (!REPAIRED.includes(d.cause) || (await repaired(payload, d))) return false
  switch (d.cause) {
    case 'run-failed':
    case 'run-abandoned':
    case 'run-stuck': {
      if (!d.run) return false
      const what = await escalate(payload, t, d.run, String(d.run.error ?? d.cause))
      return !!what && record(payload, d, what)
    }
    case 'review-escalated': {
      if ((t.reviewRounds ?? 0) <= MAX_REVIEW_ROUNDS) return false
      const what = await escalateReviewCap(payload, t)
      return !!what && record(payload, d, what)
    }
    case 'review-invalid': {
      const what = d.run && (await escalateInvalidReview(payload, t, d.run))
      return !!what && record(payload, d, what)
    }
    case 'triage-expired': {
      await payload.update({ collection: 'tickets', id: t.id, data: { triagedAt: null, triageAttempts: 0 }, ...o })
      return record(payload, d, 'Triage is offered again.')
    }
    case 'mr-missing': {
      const found = await replacementMr(payload, t)
      const relinked = found && (await payload.db.drizzle.execute(sql`UPDATE "runs" SET "artifacts" = COALESCE("artifacts", '{}'::jsonb) || ${JSON.stringify({ prUrl: found.url })}::jsonb, "updated_at" = now() WHERE "id" = (SELECT "id" FROM "runs" WHERE "ticket_id" = ${t.id} AND "kind" = 'build' ORDER BY "created_at" DESC LIMIT 1) RETURNING "id"`)).rows.length > 0
      if (!relinked) {
        if ((await sendBackToBuild(payload, t, 'The MR was closed.')) !== 'build') return false
        return record(payload, d, 'The MR was closed; back to Build.')
      }
      await payload.db.drizzle.execute(sql`UPDATE "tickets" SET "review_state" = NULL, "review_waiting_since" = NULL, "updated_at" = now() WHERE "id" = ${t.id} AND "stage" = ${nameOf(wf, 'review')} AND "review_state" = 'needs_human'`)
      await startReviewIfReady(payload, { ...t, reviewState: null })
      return record(payload, d, `Linked ${found.url} and resumed the review.`)
    }
    case 'checks-red': {
      const mr = await prOf(payload, t)
      const failed = mr ? mergeChecks(await mr.backend.forge.listChecks(mr.repo, mr.pr.headSha)).failed : []
      if ((await sendBackToBuild(payload, t, `Checks failed on the MR head: ${failed.join(', ') || 'see the MR'}. Make them pass.`)) !== 'build') return false
      return record(payload, d, 'Failing checks on the MR; back to Build.')
    }
    default:
      return false
  }
}

export const FINDING_FRESH_MS = 15 * 60_000

const storeFindings = async (payload: Payload, dead: Dead[]): Promise<void> => {
  const at = new Date().toISOString()
  for (const d of dead) await payload.db.drizzle.execute(sql`UPDATE "tickets" SET "liveness" = ${JSON.stringify({ cause: d.cause, need: d.need, at, since: d.since })}::jsonb WHERE "id" = ${d.ticket.id}`)
  await payload.db.drizzle.execute(sql`UPDATE "tickets" SET "liveness" = NULL WHERE "liveness" IS NOT NULL${dead.length ? sql` AND "id" NOT IN (${sql.join(dead.map((d) => sql`${d.ticket.id}`), sql`, `)})` : sql``}`)
}

export const sweepLiveness = async (payload: Payload): Promise<number> => {
  let repaired = (await resumeInvestigations(payload)) + (await resumeEscalationNotes(payload))
  const dead = await deadTickets(payload)
  const fixed = new Set<unknown>()
  for (const d of dead) {
    if (!REPAIRED.includes(d.cause)) continue
    try {
      if (await repair(payload, d)) {
        repaired++
        fixed.add(d.ticket.id)
      }
    } catch (e) {
      payload.logger.warn({ err: e, ticket: d.ticket.id, cause: d.cause }, 'liveness repair failed')
    }
  }
  await storeFindings(payload, dead.filter((d) => !fixed.has(d.ticket.id))).catch((e) => payload.logger.warn({ err: e }, 'liveness findings not stored'))
  return repaired
}

export const invisibleDead = async (payload: Payload, workspace: number | string): Promise<Dead[]> => (await deadTickets(payload, workspace)).filter((d) => !d.need)

