import type { HeldItem } from '../../../core/intake/held'
import type { BoardCard } from '../../../core/views/board'
import type { InboxChunk, InboxCursor, InboxGroupId } from '../../../core/views/inbox'
import type { SessionRow } from '../../../core/views/sessions'
import type { TicketStatus } from '../../../core/views/status'

export const INBOX_PAGE = 50

export const LIST_GROUPS = ['waiting', 'failed', 'working', 'others', 'decided'] as const
export type ListGroup = (typeof LIST_GROUPS)[number]

export const LIST_TITLES: Record<ListGroup, string> = {
  waiting: 'Waiting on you',
  failed: 'Failed',
  working: 'Working',
  others: 'Waiting on others',
  decided: 'Decided',
}

export const PAGED_GROUPS = ['working', 'others', 'done'] as const satisfies readonly InboxGroupId[]
export type PagedGroup = (typeof PAGED_GROUPS)[number]

export const INBOX_FIRST: Record<PagedGroup, number> = { working: INBOX_PAGE, others: INBOX_PAGE, done: 5 }

export type InboxEntry = {
  id: string
  kind: 'ticket' | 'session' | 'held'
  group: ListGroup
  number: number | null
  title: string
  href: string
  recordId: number | null
  status: TicketStatus | null
  since: string | null
  tickets: { recordId: number; number: number }[]
}

const SOURCE_GROUP: Record<Exclude<InboxGroupId, 'you'>, ListGroup> = {
  working: 'working',
  others: 'others',
  done: 'decided',
}

export const groupOf = (card: BoardCard, source: InboxGroupId): ListGroup => {
  if (source !== 'you') return SOURCE_GROUP[source]
  return card.cardReason === 'failed-runs' ? 'failed' : 'waiting'
}

export const ticketPath = (recordId: number): string => `/tickets/${recordId}`

export const entryOfCard = (card: BoardCard, source: InboxGroupId): InboxEntry => ({
  id: String(card.recordId),
  kind: 'ticket',
  group: groupOf(card, source),
  number: card.number,
  title: card.title,
  href: ticketPath(card.recordId),
  recordId: card.recordId,
  status: card.status,
  since: card.enteredAt,
  tickets: [{ recordId: card.recordId, number: card.number }],
})

export const sessionId = (id: number): string => `session-${id}`

export const entryOfSession = (session: SessionRow): InboxEntry => ({
  id: sessionId(session.id),
  kind: 'session',
  group: 'working',
  number: session.tickets[0]?.number ?? null,
  title: session.label ?? `Claude Code ${session.role}`,
  href: session.tickets[0] ? ticketPath(session.tickets[0].recordId) : '/settings/api-key',
  recordId: null,
  status: null,
  since: session.connectedAt,
  tickets: session.tickets,
})

export const entryOfHeld = (item: HeldItem): InboxEntry => ({
  id: `held-${item.itemId}`,
  kind: 'held',
  group: 'others',
  number: item.number,
  title: item.title,
  href: item.url,
  recordId: null,
  status: null,
  since: null,
  tickets: [],
})

export const connected = (sessions: SessionRow[]): SessionRow[] =>
  sessions.filter((session) => session.state === 'working' || session.state === 'idle')

type Sources = { chunks: Record<InboxGroupId, InboxChunk>; sessions: SessionRow[]; held: HeldItem[] }

export const listOf = ({ chunks, sessions, held }: Sources): InboxEntry[] => {
  const tickets = (Object.keys(chunks) as InboxGroupId[]).flatMap((source) =>
    chunks[source].cards.map((card) => entryOfCard(card, source)),
  )
  const all = [...tickets, ...connected(sessions).map(entryOfSession), ...held.map(entryOfHeld)]
  return LIST_GROUPS.flatMap((group) => all.filter((entry) => entry.group === group))
}

export const selectable = (entry: InboxEntry): boolean => entry.kind !== 'held'

export const defaultSelection = (entries: InboxEntry[]): string | null =>
  entries.find((entry) => entry.group === 'waiting')?.id ?? null

export const nextWaiting = (entries: InboxEntry[], decided: string): string | null => {
  const waiting = entries.filter((entry) => entry.group === 'waiting').map((entry) => entry.id)
  const at = waiting.indexOf(decided)
  const others = [...waiting.slice(at + 1), ...waiting.slice(0, Math.max(at, 0))]
  return others.find((id) => id !== decided) ?? null
}

export const neighbour = (entries: InboxEntry[], selected: string | null, step: 1 | -1): string | null => {
  const ids = entries.filter(selectable).map((entry) => entry.id)
  if (ids.length === 0) return null
  const at = selected === null ? -1 : ids.indexOf(selected)
  return ids[Math.min(ids.length - 1, Math.max(0, at + step))] ?? null
}

export const mergeEntries = (base: InboxEntry[], extra: InboxEntry[]): InboxEntry[] => {
  const known = new Set(base.map((entry) => entry.id))
  const all = [...base, ...extra.filter((entry) => !known.has(entry.id))]
  return LIST_GROUPS.flatMap((group) => all.filter((entry) => entry.group === group))
}

export type Paging = { cursor: InboxCursor | null; total: number; shown: number }

export const pagingOf = (chunks: Record<InboxGroupId, InboxChunk>): Record<PagedGroup, Paging> => {
  const of = (group: PagedGroup): Paging => {
    const { cards, cursor, total } = chunks[group]
    return { cursor: cards.length >= INBOX_FIRST[group] ? cursor : null, total, shown: cards.length }
  }
  return { working: of('working'), others: of('others'), done: of('done') }
}

export const LIST_OF_PAGED: Record<PagedGroup, ListGroup> = { working: 'working', others: 'others', done: 'decided' }
