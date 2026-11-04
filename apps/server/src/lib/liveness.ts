import { sql } from '@payloadcms/db-postgres'
import type { Payload, Where } from 'payload'
import { ACTIVE, startReviewIfReady, startRunIfNeeded, triageable } from '../jobs'
import { sendBackToBuild, ticketsOf } from './actions'
import { type Need, needsYou } from './needs-you'
import { forgeOf, id, isFactoryPr, mergeChecks, prOf } from './release'

type Doc = Record<string, any>
const o = { depth: 0, overrideAccess: true } as const

/** Why an open Ticket in a factory stage has no live Run. */
export const CAUSES = ['triage-expired', 'mr-missing', 'checks-red', 'run-failed', 'run-cancelled', 'run-abandoned', 'review-escalated', 'unknown'] as const
export type Cause = (typeof CAUSES)[number]
/** Causes the factory repairs itself; the others are shown to the owner as a need (`Cancelled`, `Needs you`). */
export const REPAIRED: readonly Cause[] = ['triage-expired', 'mr-missing', 'checks-red', 'run-failed', 'run-abandoned']
/** Causes an agent may repair with `return_to_build`. */
export const AGENT_REPAIRED: readonly Cause[] = ['mr-missing', 'checks-red']

export type Dead = { ticket: Doc; cause: Cause; run: Doc | null; need: Need | null }

const STAGES = ['plan', 'build', 'review']

/** The open factory MR of a Ticket, found by branch name when the linked MR is closed or missing. */
const replacementMr = async (payload: Payload, t: Doc) => {
  const { backend, repo } = await forgeOf(payload, id(t.product))
  return (await backend.forge.listPullRequests(repo, 'open')).find((pr) => isFactoryPr(pr, repo, t.number) && pr.state === 'open') ?? null
}

const causeOf = async (payload: Payload, t: Doc, latest: Doc | null): Promise<Cause | null> => {
  if (!t.stage) {
    // Untriaged and marked covered, but the only Triage Run ended unclaimed: nothing will ever look at it again.
    const covered = t.triagedAt && t.sourceUpdatedAt && new Date(t.triagedAt).getTime() >= new Date(t.sourceUpdatedAt).getTime()
    return covered && !t.mergeSha && triageable({ state: t.state, labels: t.labels ?? [], assignee: t.assignee }) && latest?.stage === 'triage' && latest.status === 'abandoned' ? 'triage-expired' : null
  }
  if (t.stage === 'review') {
    if (t.reviewState === 'merged' || t.reviewState === 'ready_for_human') return null
    try {
      const mr = await prOf(payload, t)
      if (!mr || mr.pr.state === 'closed') return 'mr-missing'
      if (mr.pr.state === 'merged' || t.reviewState !== 'needs_human') return null
      return mergeChecks(await mr.backend.forge.listChecks(mr.repo, mr.pr.headSha)).state === 'red' ? 'checks-red' : 'review-escalated'
    } catch {
      return null
    }
  }
  if (!latest || latest.stage !== t.stage) return null
  return ({ failed: 'run-failed', cancelled: 'run-cancelled', abandoned: 'run-abandoned' } as const)[latest.status as 'failed'] ?? null
}

/**
 * Open, non-parent Tickets in plan, build or review that have no live Run (`queued`, `awaiting_session`, `running`), no `waitingFor` and no `blockedBy`, with the cause and the need `needsYou` shows for them.
 * `need: null` means the owner sees nothing: the invariant is broken.
 */
export const deadTickets = async (payload: Payload, workspace?: number | string): Promise<Dead[]> => {
  const where: Where = { and: [{ state: { equals: 'open' } }, { or: [{ stage: { in: STAGES } }, { stage: { exists: false } }] }, ...(workspace === undefined ? [] : [{ workspace: { equals: workspace } }])] }
  const tickets = ((await payload.find({ collection: 'tickets', where, pagination: false, ...o })).docs as Doc[]).filter((t) => !t.waitingFor && !(t.blockedBy?.length ?? 0))
  if (!tickets.length) return []
  const runs = (await payload.find({ collection: 'runs', where: { ticket: { in: tickets.map((t) => t.id) } }, sort: '-createdAt', pagination: false, ...o })).docs as Doc[]
  const dead: Dead[] = []
  for (const t of tickets) {
    const mine = runs.filter((r) => id(r.ticket) === t.id)
    if (mine.some((r) => ACTIVE.includes(r.status))) continue
    const latest = mine[0] ?? null
    const cause = await causeOf(payload, t, latest)
    if (!cause) continue
    const need = needsYou({ stage: t.stage, labels: t.labels ?? [], releaseState: t.releaseState, productionState: t.productionState, releaseChecksState: t.releaseChecksState, reviewState: t.reviewState, reviewRounds: t.reviewRounds }, latest && { stage: latest.stage, status: latest.status })
    dead.push({ ticket: t, cause, run: latest, need })
  }
  return dead
}

/** Marks a repair on the Ticket: the marker makes it once per (Ticket, cause, Run). Returns false when it was already done. */
const claimRepair = async (payload: Payload, d: Dead, what: string): Promise<boolean> => {
  const ts = await ticketsOf(payload, id(d.ticket.product))
  const n = String(d.ticket.number)
  const marker = `<!-- bauherr:liveness:${d.cause}:${d.run?.id ?? 'none'} -->`
  if ((await ts.listComments(n)).some((c) => c.body.startsWith(marker))) return false
  await ts.comment(n, `${marker}\nBauherr liveness: ${d.cause}. ${what}`)
  return true
}

/** The Run's own Run chain says a successor already failed the same stage: a second failure is the owner's decision. */
const failedTwice = async (payload: Payload, run: Doc): Promise<boolean> => {
  if (!run.previousRun) return false
  const prev = await payload.findByID({ collection: 'runs', id: id(run.previousRun), ...o }).catch(() => null)
  return !!prev && prev.stage === run.stage && ['failed', 'abandoned'].includes(prev.status)
}

/** Repairs one dead Ticket by its cause; returns whether it acted. */
export const repair = async (payload: Payload, d: Dead): Promise<boolean> => {
  const t = d.ticket
  switch (d.cause) {
    case 'run-failed':
    case 'run-abandoned': {
      if (!d.run || (await failedTwice(payload, d.run)) || !(await claimRepair(payload, d, `Started one new ${d.run.stage} Run.`))) return false
      const { run, created } = await startRunIfNeeded(payload, t as { id: number; workspace?: unknown }, d.run.stage)
      if (created) await payload.update({ collection: 'runs', id: run.id, data: { previousRun: d.run.id }, ...o })
      return created
    }
    case 'triage-expired': {
      if (!(await claimRepair(payload, d, 'Triage is offered again.'))) return false
      await payload.update({ collection: 'tickets', id: t.id, data: { triagedAt: null, triageAttempts: 0 }, ...o })
      return true
    }
    case 'mr-missing': {
      const found = await replacementMr(payload, t)
      if (!(await claimRepair(payload, d, found ? `Linked ${found.url} and resumed the review.` : 'The MR was closed; back to Build.'))) return false
      if (!found) return (await sendBackToBuild(payload, t, 'The MR was closed.')) === 'build'
      const set = sql`"artifacts" = COALESCE("artifacts", '{}'::jsonb) || ${JSON.stringify({ prUrl: found.url })}::jsonb, "updated_at" = now()`
      const done = await payload.db.drizzle.execute(sql`UPDATE "runs" SET ${set} WHERE "id" = (SELECT "id" FROM "runs" WHERE "ticket_id" = ${t.id} AND "stage" = 'build' ORDER BY "created_at" DESC LIMIT 1) RETURNING "id"`)
      if (!done.rows.length) return (await sendBackToBuild(payload, t, 'The MR was closed.')) === 'build'
      await payload.db.drizzle.execute(sql`UPDATE "tickets" SET "review_state" = NULL, "review_waiting_since" = NULL, "updated_at" = now() WHERE "id" = ${t.id} AND "stage" = 'review' AND "review_state" = 'needs_human'`)
      await startReviewIfReady(payload, { ...t, reviewState: null })
      return true
    }
    case 'checks-red': {
      if (!(await claimRepair(payload, d, 'Failing checks on the MR; back to Build.'))) return false
      const mr = await prOf(payload, t)
      const failed = mr ? mergeChecks(await mr.backend.forge.listChecks(mr.repo, mr.pr.headSha)).failed : []
      return (await sendBackToBuild(payload, t, `Checks failed on the MR head: ${failed.join(', ') || 'see the MR'}. Make them pass.`)) === 'build'
    }
    default:
      return false
  }
}

/** One watchdog pass: repairs every dead Ticket whose cause the factory can fix itself. Returns how many it repaired. */
export const sweepLiveness = async (payload: Payload): Promise<number> => {
  let repaired = 0
  for (const d of await deadTickets(payload)) {
    if (!REPAIRED.includes(d.cause)) continue
    try {
      if (await repair(payload, d)) repaired++
    } catch (e) {
      payload.logger.warn({ err: e, ticket: d.ticket.id, cause: d.cause }, 'liveness repair failed')
    }
  }
  return repaired
}

/** Dead Tickets the owner cannot see: no live Run, no wait, no need. The goal is 0. */
export const invisibleDead = async (payload: Payload, workspace: number | string): Promise<Dead[]> => (await deadTickets(payload, workspace)).filter((d) => !d.need)

