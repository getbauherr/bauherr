import type { HeldItem } from '../../../core/intake/held'
import type { Board, BoardCard } from '../../../core/views/board'
import { STAGES } from '../../../core/events'
import { RecordNotFound } from '../../../core/record/errors'
import { ticket, type TicketView } from '../../../core/views/ticket'
import type { payloadClient } from './session'

export const GROUPS = ['you', 'working', 'others', 'done'] as const
export type GroupId = (typeof GROUPS)[number]

export type InboxRow = { kind: 'ticket'; card: BoardCard } | { kind: 'held'; item: HeldItem; repo: string }

export const GROUP_TITLES: Record<GroupId, string> = {
  you: 'Waiting on you',
  working: 'Agents working',
  others: 'Waiting on others',
  done: 'Done',
}

const groupOf = (card: BoardCard): GroupId => {
  if (card.stage === 'done') return 'done'
  if (card.state === 'owner' || card.state === 'stuck') return 'you'
  return card.state === 'agents' ? 'working' : 'others'
}

export const groupRows = (lanes: Board): Record<GroupId, InboxRow[]> => {
  const rows: Record<GroupId, InboxRow[]> = { you: [], working: [], others: [], done: [] }
  const cards = [...STAGES.flatMap((stage) => lanes.stages[stage]), ...lanes.parked]
  for (const card of cards) rows[groupOf(card)].push({ kind: 'ticket', card })
  for (const item of lanes.held) rows.others.push({ kind: 'held', item, repo: item.repo })
  return rows
}

export const waitingIds = (rows: InboxRow[]): number[] =>
  rows.flatMap((row) => (row.kind === 'ticket' ? [row.card.recordId] : []))

export const selectedTicket = async (
  payload: Awaited<ReturnType<typeof payloadClient>>,
  workspace: number,
  param: string | undefined,
): Promise<TicketView | null> => {
  const recordId = Number(param)
  if (!Number.isInteger(recordId) || recordId <= 0) return null
  return ticket(payload, { workspace, recordId }).catch((error: unknown) => {
    if (error instanceof RecordNotFound) return null
    throw error
  })
}
