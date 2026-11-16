import type { DecisionOption } from '../../../lib/decision'
import type { InboxGroup, InboxItem } from './inbox'

export type InboxFilters = { product?: number; checkpoint?: string }

/** `/inbox` with the filters and the selected Ticket (`?t=`). */
export const inboxHref = (f: InboxFilters, t?: number): string => {
  const q = new URLSearchParams()
  if (f.product) q.set('product', String(f.product))
  if (f.checkpoint) q.set('checkpoint', f.checkpoint)
  if (t) q.set('t', String(t))
  return q.size ? `/inbox?${q}` : '/inbox'
}

/**
 * The row `?t=` selects. A known `t` is the selection and, below 960px, the detail; an unknown or already decided `t` is `stale`
 * (the page says so) and the first row is selected. Without `t` the first row is selected, and only the wide layout shows it.
 */
export const resolveSelection = (groups: InboxGroup[], t?: number): { selected: InboxItem | null; detail: boolean; stale: boolean } => {
  const rows = groups.flatMap((g) => g.items)
  const hit = t ? rows.find((r) => r.id === t) : undefined
  return { selected: hit ?? rows[0] ?? null, detail: !!hit, stale: !!t && !hit }
}

/** The row to select once `id` has left the list: the one after it, else the one before. */
export const nextRow = (groups: InboxGroup[], id: number): number | undefined => {
  const rows = groups.flatMap((g) => g.items)
  const at = rows.findIndex((r) => r.id === id)
  return (rows[at + 1] ?? rows[at - 1])?.id
}

/** `#t<id>` (old links from the Workflow view, the Ticket's steps and Requests) becomes `?t=<id>`, keeping the filters of `search`. */
export const redirectHref = (hash: string, search: string): string | null => {
  const m = /^#t(\d+)$/.exec(hash)
  if (!m) return null
  const q = new URLSearchParams(search)
  q.set('t', m[1]!)
  return `/inbox?${q}`
}

/** What an Inbox without rows says: nothing at all, nothing under the filter, or nothing because loading failed. */
export const emptyCopy = ({ error, picked, owner, working }: { error?: boolean; picked?: string; owner: boolean; working: number }): { text: string; action: { href: string; label: string } } =>
  error ? { text: 'Could not load the Inbox. Try again.', action: { href: '/inbox', label: 'Try again' } }
  : picked ? { text: `Nothing waits for you at ${picked}.`, action: { href: '/inbox', label: 'Show all decisions' } }
  : owner ? { text: 'Nothing waits for you.', action: { href: '/requests', label: 'Open Requests' } }
  : { text: `Nothing needs you. The factory is working on ${working} ticket${working === 1 ? '' : 's'}.`, action: { href: '/', label: 'Open the Workflow' } }

/** Rows of a group shown before "Show N more". */
export const ROW_LIMIT = 25

/** The rows of a group to render: the first 25, all when expanded or when the selected row lies beyond them. */
export const visibleRows = <T extends { id: number }>(items: T[], selected: number | undefined, expanded: boolean): T[] =>
  expanded || items.length <= ROW_LIMIT || items.findIndex((i) => i.id === selected) >= ROW_LIMIT ? items : items.slice(0, ROW_LIMIT)

/** The relative waiting text of a row ("5 min") from `waited()`'s "Waiting for you · 5 min". */
export const waitingText = (waiting: string): string => waiting.split(' · ').pop()!

const PAST: Partial<Record<DecisionOption['action'], string>> = { approvePlan: 'Plan approved', acceptStaging: 'Accepted on staging', approveProduction: 'Production approved', grantRound: 'One more round given', stopReview: 'Review stopped', backToBuild: 'Sent back to build', backToBacklog: 'Sent back to the backlog', requestChanges: 'Changes requested', expedite: 'Put on the fast lane', releaseLane: 'Fast lane released', rerun: 'Re-run started', approveSkill: 'Skill proposal approved', rejectSkill: 'Skill proposal rejected' }

/** What the pane says once an option ran: "Plan approved for #471. Next: #455." */
export const announcement = (o: DecisionOption, number: number, next?: number): string =>
  `${PAST[o.action] ?? `${o.label} done`} for #${number}.${next ? ` Next: #${next}.` : ''}`

/**
 * The pane's action bar: at most one primary (the card's first), the other options as secondaries, and "Answer N questions" only while `open` questions remain
 * (it is the primary of a card that has no other primary). A Triage "Answer questions" card has open questions by definition, its count unknown here, so its link is "Answer questions". The card's own link to the conversation is dropped; the bar replaces it.
 */
export const actionBar = (options: DecisionOption[], open: number, ticket: number, need?: string): { primary: DecisionOption | null; secondary: DecisionOption[]; answer: { label: string; href: string } | null } => {
  const rest = options.filter((o) => !(o.action === 'open' && o.href?.includes('?view=conversation')))
  const href = `/tickets/${ticket}?view=conversation`
  const answer = open > 0 ? { label: `Answer ${open} question${open === 1 ? '' : 's'}`, href } : need === 'Answer questions' ? { label: 'Answer questions', href } : null
  const primary = rest.find((o) => o.primary) ?? null
  return { primary, secondary: rest.filter((o) => o !== primary), answer }
}

/** What the Inbox keeps while decisions run: rows removed at once (`gone`), those the server has since confirmed (`settled`), and the last failure with a snapshot of its row. */
export type PaneState = { gone: number[]; settled: number[]; failed: { item: InboxItem; error: string; at: number | null } | null }
export const emptyPane: PaneState = { gone: [], settled: [], failed: null }

const rowsLeft = (groups: InboxGroup[], gone: number[]): InboxGroup[] => groups.map((g) => ({ ...g, items: g.items.filter((i) => !gone.includes(i.id)) }))

/** The option was clicked: the row leaves the list and the next row (if any) becomes the selection; after the last row the decided id stays selected until the refresh resolves. */
export const removeRow = (s: PaneState, groups: InboxGroup[], id: number): { state: PaneState; next: InboxItem | undefined } => {
  const nextId = nextRow(rowsLeft(groups, s.gone), id)
  return { state: { ...s, gone: s.gone.includes(id) ? s.gone : [...s.gone, id], failed: null }, next: groups.flatMap((g) => g.items).find((i) => i.id === nextId) }
}

/** The action succeeded: the row stays gone until the server list has caught up. */
export const settleRow = (s: PaneState, id: number): PaneState => ({ ...s, settled: [...s.settled, id] })

/** A new server list arrived: it wins over the rows removed at once that the server has confirmed. */
export const syncRows = (s: PaneState): PaneState => (s.settled.length ? { ...s, gone: s.gone.filter((id) => !s.settled.includes(id)), settled: [] } : s)

/**
 * The action failed: the row is back (with a snapshot, so the pane needs no server row) and carries the error. The selection returns to it only while it is still where
 * the removal moved it (`advancedTo`); a person who has moved on keeps their place.
 */
export const restoreRow = (s: PaneState, item: InboxItem, error: string, selection: number | null, advancedTo: number | null): { state: PaneState; goTo: number | undefined } => ({
  state: { ...s, gone: s.gone.filter((id) => id !== item.id), failed: { item, error, at: selection } },
  goTo: selection === advancedTo ? item.id : undefined,
})

/** A failure is shown while the selection is where it happened or on the failed row; any other selection clears it. */
export const selectionChanged = (s: PaneState, selection: number | null): PaneState => (s.failed && selection !== s.failed.at && selection !== s.failed.item.id ? { ...s, failed: null } : s)
