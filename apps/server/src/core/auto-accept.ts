import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { namesOf } from './deploy'
import { loadShots, pairProblems, pairsOf } from './attachments/pairs'
import type { AutoAccepted } from './events'
import type { State } from './lifecycle'
import type { TicketRecord } from './record/schema'
import { appendEvent, type StoredRecord } from './record/store'
import { loadMockups } from './views/attachments'
import { doneTickets } from './views/time-load'

export const NEEDS_OWNER_LABEL = 'bauherr:needs-owner'
export const AUTO_ACCEPT_ACTOR = 'auto-accept'
export const SEND_BACK_DAYS = 30

export type AutoAcceptFacts = {
  maxSendBack: number
  door: 'one-way' | 'two-way' | null
  criteria: { met: number; total: number }
  dropped: number
  overridden: boolean
  checks: State['checks']
  requiredChecks: number
  outsider: boolean
  openPictures: number
  needsOwner: boolean
  history: { done: number; sentBack: number } | null
}

const eligibilityBlocker = (facts: AutoAcceptFacts): string | null => {
  if (facts.outsider) return 'The ticket came from outside the team.'
  if (facts.door !== 'two-way') return 'The change cannot be undone.'
  return facts.requiredChecks === 0 ? 'No required checks are configured.' : null
}

const earlyBlocker = (facts: AutoAcceptFacts): string | null => {
  const { criteria } = facts
  const eligibility = eligibilityBlocker(facts)
  if (eligibility !== null) return eligibility
  if (criteria.total === 0 || criteria.met < criteria.total || facts.overridden) return 'A criterion is not met.'
  if (facts.dropped > 0) return 'A criterion was dropped.'
  if (facts.checks !== 'passed') return 'The checks are not green.'
  if (facts.openPictures > 0) return 'A before and after picture is missing.'
  return facts.needsOwner ? `The ticket is labelled ${NEEDS_OWNER_LABEL}.` : null
}

const blockerOf = (facts: AutoAcceptFacts): string | null => {
  const early = earlyBlocker(facts)
  const { history } = facts
  if (early !== null || history === null) return early
  if (history.done === 0) return 'No ticket was accepted in the last 30 days to judge by.'
  return history.sentBack * 100 > facts.maxSendBack * history.done ? 'Too many tickets were sent back.' : null
}

export const isEarlyBlocked = (facts: AutoAcceptFacts): boolean => earlyBlocker(facts) !== null

export const autoAcceptedOf = (facts: AutoAcceptFacts): AutoAccepted | null => {
  const { history, criteria } = facts
  if (history === null || blockerOf(facts) !== null) return null
  return {
    door: 'two-way',
    criteriaMet: criteria.met,
    criteriaTotal: criteria.total,
    checks: 'passed',
    sendBackPercent: history.done === 0 ? 0 : (history.sentBack * 100) / history.done,
    maxSendBackPercent: facts.maxSendBack,
  }
}

const count = z.coerce.number()
const productRow = z.object({
  product_id: count,
  auto_accept: z.boolean().nullable(),
  max_send_back: count.nullable(),
  required_checks: z.string().nullable(),
})
const DEFAULT_MAX_SEND_BACK = 10

const isOutsider = (source: TicketRecord['source']): boolean =>
  source.external || source.alert !== undefined

type Deps = { payload: Payload; now: Date }

const needsOwner = async (payload: Payload, stored: StoredRecord): Promise<boolean> => {
  const { repo, number } = stored.record.source
  const found = await payload.db.drizzle.execute(sql`
    SELECT 1 FROM "mirror_items"
    WHERE "workspace_id" = ${stored.workspace} AND "repo" = ${repo} AND "number" = ${number} AND "kind" = 'issue'
      AND "labels" ? ${NEEDS_OWNER_LABEL}`)
  return found.rows.length > 0
}

const openPictures = async (payload: Payload, stored: StoredRecord, state: State): Promise<number> => {
  if (!stored.record.visible) return 0
  const screens = (await loadMockups(payload, stored.id)).map((mockup) => mockup.screen)
  if (screens.length === 0) return 1
  const pairs = pairsOf(screens, await loadShots(payload, stored.id))
  return pairProblems(pairs, state.patch?.headSha ?? '').length
}

const sendBacks = async (deps: Deps, stored: StoredRecord, product: number) => {
  const tickets = await doneTickets(deps.payload, {
    workspace: stored.workspace,
    product,
    now: deps.now,
    days: SEND_BACK_DAYS,
  })
  return { done: tickets.length, sentBack: tickets.filter((ticket) => ticket.time.sentBack > 0).length }
}

export const autoAcceptFor = async (deps: Deps, stored: StoredRecord, state: State): Promise<AutoAccepted | null> => {
  const found = await deps.payload.db.drizzle.execute(sql`
    SELECT p."id" AS product_id, p."auto_accept", p."auto_accept_max_send_back" AS max_send_back,
      p."required_checks"
    FROM "records" r JOIN "products" p ON p."id" = r."product_id" WHERE r."id" = ${stored.id}`)
  const row = found.rows[0] ? productRow.parse(found.rows[0]) : null
  if (row === null || row.auto_accept !== true) return null
  const { record } = stored
  const facts: AutoAcceptFacts = {
    maxSendBack: row.max_send_back ?? DEFAULT_MAX_SEND_BACK,
    door: record.risk?.door ?? null,
    criteria: { met: record.criteria.filter((c) => c.status === 'met').length, total: record.criteria.length },
    dropped: record.dropped.length,
    overridden: state.overridden,
    checks: state.checks,
    requiredChecks: namesOf(row.required_checks).length,
    outsider: isOutsider(record.source),
    openPictures: await openPictures(deps.payload, stored, state),
    needsOwner: await needsOwner(deps.payload, stored),
    history: null,
  }
  if (isEarlyBlocked(facts)) return null
  return autoAcceptedOf({ ...facts, history: await sendBacks(deps, stored, row.product_id) })
}

export const recordAutoAccept = async (payload: Payload, recordId: number, auto: AutoAccepted): Promise<void> => {
  await appendEvent(payload, recordId, {
    type: 'result.accepted',
    data: { auto },
    actor: 'factory',
    actorId: AUTO_ACCEPT_ACTOR,
  })
}
