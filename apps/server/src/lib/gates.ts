import { createHash } from 'node:crypto'
import type { Payload } from 'payload'
import { openOwnerRows, unansweredCriticalCount } from '../app/(app)/lib/plan'
import type { TicketSource } from '@bauherr/adapters'
import { PROOF_NEEDS, decisionMarkdown, justDecided, prepareDecision, sameDecision } from './decision'
import { template } from './templates'
import { record } from './history'
import { hasProductionChecks } from './mode'
import { type Need, needsOf, PARKING_NEEDS, parkingNeed } from './needs-you'
import { publicUrl } from './oidc'
import { proofMarkdown } from './artifacts'
import { startRunIfNeeded } from '../jobs'
import { holdOverlap } from './overlap'
import { cas, forgeOf, id } from './release'
import { sql } from '@payloadcms/db-postgres'
import { syncProgress } from './progress'
import { workflowFor } from './factory'
import { gatesOf } from './staging'
import { askedOf, needBy } from './addressee'
import { productOwnersOfTicket } from './people'
import { decisionComments, gateOwnersOf, logins } from './forge-channel'
import { rejoin } from './wip'
import { jobsOpen, visitWorst } from './stage-jobs'
import { is, stage as stageDef, wipStages } from './workflow'

type Doc = Record<string, any>
const o = { overrideAccess: true, depth: 0 } as const
const PLAN_GATES: (Need | null)[] = ['Approve plan', 'Answer decisions']

export const storeOpenCritical = async (payload: Payload, ticket: number | string, comments: Parameters<typeof unansweredCriticalCount>[0]): Promise<number> => {
  const n = unansweredCriticalCount(comments)
  await cas(payload, ticket, sql`"open_critical_decisions" = ${n}::int`, sql`"open_critical_decisions" IS DISTINCT FROM ${n}::int`)
  const rows = openOwnerRows(comments)
  await cas(payload, ticket, sql`"open_owner_rows" = ${rows}::int`, sql`"open_owner_rows" IS DISTINCT FROM ${rows}::int`)
  return n
}

export const ownsGate = async (payload: Payload, t: Doc, login: string): Promise<boolean> =>
  !!(t.gateNotified || logins(t.gateAssignees).length) && (await gateOwnersOf(payload, t.workspace)).some((l) => l.toLowerCase() === login.toLowerCase())

const sessionLoginsOf = async (payload: Payload, ticketId: number | string): Promise<string[]> => {
  const runs = await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: ticketId } }, { mode: { equals: 'session' } }, { status: { equals: 'running' } }] }, pagination: false, ...o, depth: 1 })
  return runs.docs.flatMap((r) => ((r.sessionOwner as Doc | null)?.githubLogin ?? process.env.BAUHERR_BOT_LOGIN) || [])
}

const definitive = (e: unknown): boolean => [404, 422].includes((e as { status?: number }).status ?? 0)

export const syncGate = async (payload: Payload, t: Doc, run: { id: number | string; stage: string; kind?: string | null; job?: string | null; status: string; reasonKind?: string | null } | null): Promise<boolean> => {
  const wf = workflowFor(t.workspace)
  const productionChecksMissing = is(wf, t.stage, 'release') && t.productionState === 'awaiting_approval' && !hasProductionChecks((await payload.findByID({ collection: 'products', id: id(t.product), ...o })) as Doc)
  const raw = needsOf(wf, { ...t, jobsOpen: await jobsOpen(payload, t) }, run, productionChecksMissing, await gatesOf(payload, wf, t))
  const candidate = justDecided(t, raw) ? null : raw
  if ((t.needsYou ?? null) !== candidate) await cas(payload, t.id, sql`"needs_you" = ${candidate}`, sql`"needs_you" IS DISTINCT FROM ${candidate}`)
  const liveRun = candidate && PARKING_NEEDS.includes(candidate) ? (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: t.id } }, { status: { in: ['running', 'queued', 'awaiting_session'] } }] }, limit: 1, select: { status: true }, ...o })).docs[0] as { status: string } | undefined : null
  const parking = parkingNeed(wf, t, candidate, liveRun ?? run)
  if ((t.parkedNeed ?? null) !== parking) {
    if (!parking && t.parkedNeed && t.state === 'open' && wipStages(wf).includes(t.stage)) await rejoin(payload, t)
    else await cas(payload, t.id, sql`"parked_need" = ${parking}`, sql`"parked_need" IS DISTINCT FROM ${parking}`)
  }
  const nominal = candidate ? needBy(wf, candidate, t.stage) : null
  const ownerRows = nominal === 'product-owner' ? await productOwnersOfTicket(payload, t) : []
  const asked = candidate ? askedOf(nominal!, ownerRows.length > 0) : null
  if ((t.needsBy ?? null) !== asked) await cas(payload, t.id, sql`"needs_by" = ${asked}`, sql`"needs_by" IS DISTINCT FROM ${asked}`)
  const decision = candidate ? await prepareDecision(payload, t, candidate, run) : null
  if (!sameDecision(t.decision, decision)) await cas(payload, t.id, sql`"decision" = ${decision ? JSON.stringify(decision) : null}::jsonb`, sql`true`)
  await record(payload, t.id, { cause: 'sweep' }, { ticket: t, run })
  const held: Need | null = t.gateNotified ?? null
  const mine = logins(t.gateAssignees)
  if (!candidate && !held && !mine.length && !t.gateUnreachable) return false
  const owners = !candidate ? [] : asked === 'product-owner' ? ownerRows.flatMap((u) => logins(u.githubLogin)) : await gateOwnersOf(payload, t.workspace)
  const base = owners.length ? candidate : null
  let forge: ReturnType<typeof forgeOf> | undefined
  const source = async (): Promise<TicketSource> => (await (forge ??= forgeOf(payload, id(t.product)))).tickets
  const open = candidate === 'Approve plan' ? await (async () => storeOpenCritical(payload, t.id, await decisionComments(payload, t, await source(), { notify: true })))().catch((e) => { if (!PLAN_GATES.includes(held)) throw e; return null }) : null
  let want = base
  if (base === 'Approve plan' && PLAN_GATES.includes(held)) want = held
  else if (base === 'Approve plan' && open) want = 'Answer decisions'
  if (want === held && (want || (!mine.length && !t.gateUnreachable))) return false
  const n = String(t.number)
  let added = mine
  if (mine.length && (held || !want)) {
    const sessions = await sessionLoginsOf(payload, t.id)
    const gone = mine.filter((l) => !owners.includes(l) && !sessions.includes(l))
    if (gone.length) await (await source()).unassign(n, gone)
    added = mine.filter((l) => !gone.includes(l))
  }
  let complete = false
  let mentioned = owners
  if (want) {
    const ts = await source()
    const assigned = logins(t.assignees)
    added = [...added]
    const dropped: string[] = []
    for (const login of owners.filter((l) => !assigned.includes(l) && !added.includes(l))) {
      try {
        await ts.claim(n, login)
        added.push(login)
      } catch (e) {
        payload.logger.warn({ err: e, ticket: t.id, login }, 'gate assignee failed')
        if (definitive(e)) dropped.push(login)
      }
    }
    mentioned = owners.filter((l) => !dropped.includes(l))
    complete = mentioned.length > 0 && mentioned.every((l) => assigned.includes(l) || added.includes(l))
    const marker = `<!-- bauherr:gate:${want}:${createHash('sha1').update(`${want}${run?.id ?? ''}`).digest('hex')} -->`
    if (mentioned.length && !(await ts.listComments(n)).some((c) => c.body.startsWith(marker))) {
      const claim = marker
      if (await cas(payload, t.id, sql`"gate_notice_claim" = ${claim}`, sql`"gate_notice_claim" IS DISTINCT FROM ${claim}`)) {
        try {
          await ts.comment(n, `${marker}\n${mentioned.map((l) => `@${l}`).join(' ')}: ${t.expedite ? 'Hotfix, ' : ''}${want} — ${publicUrl()}/tickets/${t.id}${decision && decision.need === want ? `\n\n${decisionMarkdown(decision, await template(payload, id(t.workspace), 'decision'), PROOF_NEEDS.includes(want) ? await proofMarkdown(payload, t, `${publicUrl()}/tickets/${t.id}`) : undefined)}` : ''}`)
        } catch (e) {
          await cas(payload, t.id, sql`"gate_notice_claim" = NULL`, sql`"gate_notice_claim" = ${claim}`)
          throw e
        }
      }
    }
  }
  const notified = complete ? want : null
  const unreachable = want && !mentioned.length ? want : null
  if (notified === held && added.join(',') === mine.join(',') && unreachable === (t.gateUnreachable ?? null)) return false
  await payload.update({
    collection: 'tickets',
    id: t.id,
    data: { gateNotified: notified, gateNotifiedAt: notified === held ? t.gateNotifiedAt : notified ? new Date().toISOString() : null, gateAssignees: added.join(',') || null, gateUnreachable: unreachable },
    ...o,
  })
  const factory = [...mine, ...added]
  if (is(wf, t.stage, 'plan', 'build') && t.state === 'open' && !t.waitingFor && logins(t.assignees).every((a) => factory.includes(a))) {
    const runs = await payload.count({ collection: 'runs', where: { and: [{ ticket: { equals: t.id } }, { stage: { equals: t.stage } }, { job: { exists: false } }] }, ...o })
    if (!runs.totalDocs && !(is(wf, t.stage, 'build') && (await holdOverlap(payload, t)))) await startRunIfNeeded(payload, t as { id: number; workspace?: unknown }, t.stage)
  }
  return true
}

export const syncGates = async (payload: Payload, expediteOnly = false): Promise<number> => {
  const tickets = (await payload.find({ collection: 'tickets', sort: '-expedite', where: { and: [...(expediteOnly ? [{ expedite: { equals: true } }] : []), { or: [{ state: { equals: 'open' } }, { gateNotified: { exists: true } }, { gateAssignees: { exists: true } }, { gateUnreachable: { exists: true } }, { and: [{ state: { equals: 'closed' } }, { progressHash: { exists: true } }, { updatedAt: { greater_than: new Date(Date.now() - 2 * 864e5).toISOString() } }] }] }] }, pagination: false, ...o })).docs as Doc[]
  if (!tickets.length) return 0
  const runsOf = new Map<number, Doc[]>()
  for (const r of (await payload.find({ collection: 'runs', where: { ticket: { in: tickets.map((t) => t.id) } }, sort: '-createdAt', pagination: false, ...o })).docs as Doc[]) {
    runsOf.set(r.ticket, [...(runsOf.get(r.ticket) ?? []), r])
  }
  const latest = new Map<number, Doc>()
  for (const t of tickets) {
    const runs = runsOf.get(t.id) ?? []
    const run = stageDef(workflowFor(t.workspace), t.stage)?.jobs ? visitWorst(t, runs) : runs[0]
    if (run) latest.set(t.id, run)
  }
  let changed = 0
  for (const t of tickets) {
    try {
      if (await syncGate(payload, t, (latest.get(t.id) as { id: number; stage: string; status: string; reasonKind?: string | null } | undefined) ?? null)) changed++
    } catch (e) {
      payload.logger.error({ err: e, ticket: t.id }, 'syncGate failed')
    }
  }
  await syncProgress(payload, tickets.filter((t) => t.progressHash || t.progressCommentId).map((t) => t.id))
  return changed
}
