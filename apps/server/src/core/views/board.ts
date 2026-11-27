import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import type { Stage } from '../events'
import type { HeldItem } from '../intake/held'
import type { WaitingOn } from '../record/store'
import { classifiedIn } from './classified'
import { loadLaneAfter, loadLanes, loadLaneTotals, type LaneCursor } from './lanes'
import { loadRelations, type CardRelations } from './relations'
import { loadRows, type ClosedAs, type RowFilter, type TicketRow } from './rows'
import { DAY_MS, LIVE_SQL, scope } from './sql'
import { isStuck, stateOf, statusOf, type TicketState, type TicketStatus } from './status'

export type BoardCard = {
  recordId: number
  number: number
  repo: string
  title: string
  product: { id: number; name: string }
  stage: Stage
  waitingOn: WaitingOn
  state: TicketState
  status: TicketStatus
  detail: string | null
  enteredAt: string
  run: { role: 'builder' | 'reviewer' | 'verifier'; leasedBy: string | null } | null
  rank: number
  cardReason: string | null
  parkedReason: string | null
  closedAs: ClosedAs | null
  criteria: { met: number; total: number } | null
  adopted: { pr: number; author: string } | null
  relations: CardRelations | null
}

export type Board = {
  stages: Record<Stage, BoardCard[]>
  held: HeldItem[]
  parked: BoardCard[]
  totals: Record<Stage, number> | null
}

type RelationKind = 'blocking' | 'blocked'

export type BoardScope = { relation?: RelationKind | undefined; parent?: 'with' | 'without' | undefined }

const MATCHES: Record<RelationKind, (relations: CardRelations) => boolean> = {
  blocking: (relations) => relations.blocks.length > 0,
  blocked: (relations) => relations.blockedBy.length > 0,
}

type Entry = [number, CardRelations]

const scoped = (filter: RowFilter, relations: Map<number, CardRelations>, scope: BoardScope): RowFilter => {
  const { relation, parent } = scope
  if (relation === undefined && parent === undefined) return filter
  const entries = [...relations]
  const hasParent = ([, related]: Entry) => related.parent !== null
  if (relation === undefined && parent === 'without') {
    return { ...filter, without: entries.filter(hasParent).map(([id]) => id) }
  }
  const matches = ([, related]: Entry) => relation === undefined || MATCHES[relation](related)
  const fits = (entry: Entry) => parent === undefined || hasParent(entry) === (parent === 'with')
  return { ...filter, ids: entries.filter((entry) => matches(entry) && fits(entry)).map(([id]) => id) }
}

const isScoped = ({ relation, parent }: BoardScope): boolean => relation !== undefined || parent !== undefined

const openAmong = async (payload: Payload, filter: RowFilter, ids: number[]): Promise<Set<number>> => {
  if (ids.length === 0) return new Set()
  const result = await payload.db.drizzle.execute(sql`
    SELECT r."id" FROM "records" r
    WHERE ${scope(filter.workspace, filter.product)} AND ${LIVE_SQL}
      AND r."id" IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`)
  return new Set(result.rows.map((row) => Number(row['id'])))
}

export const relationCounts = async (payload: Payload, filter: RowFilter): Promise<Record<RelationKind, number>> => {
  const relations = await loadRelations(payload, filter.workspace)
  const open = await openAmong(payload, filter, [...relations.keys()])
  const count = (kind: RelationKind) =>
    [...relations].filter(([id, related]) => open.has(id) && MATCHES[kind](related)).length
  return { blocking: count('blocking'), blocked: count('blocked') }
}

const parkedOf = (row: TicketRow): string | null =>
  row.card?.reason === 'parked' ? `Parked: ${row.card.text ?? ''} (${row.stage})` : null

const detailOf = (row: TicketRow): string | null => {
  const parked = parkedOf(row)
  if (parked !== null) return parked
  if (row.run?.step) return row.run.step
  if (row.waitingOn === 'reporter' && row.reporterRound !== null) return `Question round ${row.reporterRound}`
  if (row.verifyRounds > 0 && (row.stage === 'build' || row.stage === 'verify')) {
    return `Round ${row.verifyRounds + 1}`
  }
  return null
}

export const toCard = (row: TicketRow): BoardCard => {
  const hasRun = row.run !== null
  const stuck = isStuck(row.card)
  const { stage, waitingOn, card, parked, ended } = row
  return {
    recordId: row.recordId,
    number: row.number,
    repo: row.repo,
    title: row.title,
    product: row.product,
    stage,
    waitingOn,
    state: row.parked === null ? stateOf({ waitingOn, stuck, hasRun }) : 'none',
    status: statusOf({
      stage,
      waitingOn,
      card,
      parked,
      hasRun,
      reviewer: row.run?.role === 'reviewer',
      claimed: row.run?.leasedBy != null,
      questionDrafted: row.questionDrafted,
      ended,
    }),
    detail: detailOf(row),
    enteredAt: row.enteredAt.toISOString(),
    run: row.run === null ? null : { role: row.run.role, leasedBy: row.run.leasedBy },
    rank: row.rank,
    cardReason: row.card?.reason ?? null,
    parkedReason: parked,
    closedAs: row.closedAs,
    criteria: row.criteria.total > 0 ? row.criteria : null,
    adopted: row.adopted,
    relations: null,
  }
}

export const heldOf = async (payload: Payload, filter: RowFilter): Promise<HeldItem[]> =>
  (await classifiedIn(payload, filter))
    .filter(({ selection }) => selection.action === 'hold')
    .map(({ candidate, selection }) => ({
      itemId: candidate.itemId,
      repo: candidate.repo,
      number: candidate.number,
      title: candidate.title,
      url: candidate.url,
      author: candidate.item.author,
      reason: selection.reason,
    }))

const recentlyEnded = (row: TicketRow, now: Date): boolean =>
  row.endedAt !== null && row.endedAt.getTime() >= now.getTime() - 7 * DAY_MS

export const laneCursor = (card: BoardCard): LaneCursor => ({
  rank: card.rank,
  enteredAt: card.enteredAt,
  id: card.recordId,
})

export const laneMore = async (
  payload: Payload,
  filter: RowFilter,
  input: { stage: Stage; after: LaneCursor; limit: number; scope?: BoardScope },
): Promise<BoardCard[]> => {
  const relations = await loadRelations(payload, filter.workspace)
  const rows = await loadLaneAfter(payload, scoped(filter, relations, input.scope ?? {}), input)
  return rows.map((row) => ({ ...toCard(row), relations: relations.get(row.recordId) ?? null }))
}

export const board = async (
  payload: Payload,
  filter: RowFilter,
  limit?: number,
  boardScope: BoardScope = {},
): Promise<Board> => {
  const relations = await loadRelations(payload, filter.workspace)
  const only = scoped(filter, relations, boardScope)
  const [rows, held, totals] = await Promise.all([
    limit === undefined ? loadRows(payload, only) : loadLanes(payload, only, limit),
    isScoped(boardScope) ? Promise.resolve([]) : heldOf(payload, filter),
    isScoped(boardScope) && limit !== undefined ? loadLaneTotals(payload, only) : Promise.resolve(null),
  ])
  const toRelatedCard = (row: TicketRow): BoardCard => ({
    ...toCard(row),
    relations: relations.get(row.recordId) ?? null,
  })
  const stages: Record<Stage, BoardCard[]> = { intake: [], brief: [], build: [], verify: [], ship: [], done: [] }
  const parked: BoardCard[] = []
  for (const row of rows) {
    if (row.parked !== null) parked.push(toRelatedCard(row))
    else if (row.stage !== 'done' || recentlyEnded(row, filter.now)) stages[row.stage].push(toRelatedCard(row))
  }
  return { stages, held, parked, totals }
}
