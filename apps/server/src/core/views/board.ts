import type { Payload } from 'payload'
import type { Stage } from '../events'
import type { HeldItem } from '../intake/held'
import type { WaitingOn } from '../record/store'
import { classifiedIn } from './classified'
import { loadRows, type RowFilter, type TicketRow } from './rows'
import { DAY_MS } from './sql'
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
}

export type Board = { stages: Record<Stage, BoardCard[]>; held: HeldItem[]; parked: BoardCard[] }

const detailOf = (row: TicketRow): string | null => {
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
    status: statusOf({ stage, waitingOn, card, parked, hasRun, ended }),
    detail: detailOf(row),
    enteredAt: row.enteredAt.toISOString(),
    run: row.run === null ? null : { role: row.run.role, leasedBy: row.run.leasedBy },
    rank: row.rank,
    cardReason: row.card?.reason ?? null,
  }
}

const heldOf = async (payload: Payload, filter: RowFilter): Promise<HeldItem[]> =>
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

export const board = async (payload: Payload, filter: RowFilter): Promise<Board> => {
  const rows = await loadRows(payload, filter)
  const stages: Record<Stage, BoardCard[]> = { intake: [], brief: [], build: [], verify: [], ship: [], done: [] }
  const parked: BoardCard[] = []
  for (const row of rows) {
    if (row.parked !== null) parked.push(toCard(row))
    else if (row.stage !== 'done' || recentlyEnded(row, filter.now)) stages[row.stage].push(toCard(row))
  }
  return { stages, held: await heldOf(payload, filter), parked }
}
