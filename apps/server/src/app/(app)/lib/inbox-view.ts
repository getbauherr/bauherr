import type { DecisionOption } from '../../../lib/decision'
import type { InboxGroup, InboxItem } from './inbox'

export type InboxFilters = { product?: number; checkpoint?: string }

export const inboxHref = (f: InboxFilters, t?: number): string => {
  const q = new URLSearchParams()
  if (f.product) q.set('product', String(f.product))
  if (f.checkpoint) q.set('checkpoint', f.checkpoint)
  if (t) q.set('t', String(t))
  return q.size ? `/inbox?${q}` : '/inbox'
}

export const resolveSelection = (groups: InboxGroup[], t?: number): { selected: InboxItem | null; detail: boolean; stale: boolean } => {
  const rows = groups.flatMap((g) => g.items)
  const hit = t ? rows.find((r) => r.id === t) : undefined
  return { selected: hit ?? rows[0] ?? null, detail: !!hit, stale: !!t && !hit }
}

export const nextRow = (groups: InboxGroup[], id: number): number | undefined => {
  const rows = groups.flatMap((g) => g.items)
  const at = rows.findIndex((r) => r.id === id)
  return (rows[at + 1] ?? rows[at - 1])?.id
}

export const redirectHref = (hash: string, search: string): string | null => {
  const m = /^#t(\d+)$/.exec(hash)
  if (!m) return null
  const q = new URLSearchParams(search)
  q.set('t', m[1]!)
  return `/inbox?${q}`
}

export const emptyCopy = ({ error, picked, owner, working }: { error?: boolean; picked?: string; owner: boolean; working: number }): { text: string; action: { href: string; label: string } } =>
  error ? { text: 'Could not load the Inbox. Try again.', action: { href: '/inbox', label: 'Try again' } }
  : picked ? { text: `Nothing waits for you at ${picked}.`, action: { href: '/inbox', label: 'Show all decisions' } }
  : owner ? { text: 'Nothing waits for you.', action: { href: '/requests', label: 'Open Requests' } }
  : { text: `Nothing needs you. The factory is working on ${working} ticket${working === 1 ? '' : 's'}.`, action: { href: '/', label: 'Open the Workflow' } }

export const ROW_LIMIT = 25

export const visibleRows = <T extends { id: number }>(items: T[], selected: number | undefined, expanded: boolean): T[] =>
  expanded || items.length <= ROW_LIMIT || items.findIndex((i) => i.id === selected) >= ROW_LIMIT ? items : items.slice(0, ROW_LIMIT)

export const waitingText = (waiting: string): string => waiting.split(' · ').pop()!

export const isUnseen = (i: { id: number; unseen?: boolean }, local: Record<number, boolean>): boolean => local[i.id] ?? !!i.unseen

export const SEEN_AFTER_MS = 1000

export type InboxKey = 'next' | 'prev' | 'primary' | 'open' | 'sendBack' | 'unread' | 'filters' | 'help' | 'back'

const KEYS: Record<string, InboxKey> = { j: 'next', ArrowDown: 'next', k: 'prev', ArrowUp: 'prev', e: 'primary', o: 'open', r: 'sendBack', u: 'unread', '/': 'filters', '?': 'help', Escape: 'back' }

export const KEY_HELP: [string, string][] = [['j / k, Arrow down / Arrow up', 'Next / previous decision'], ['e', 'Take the primary action'], ['o', 'Open the Ticket'], ['r', 'Send back'], ['u', 'Toggle unread'], ['/', 'Focus the filters'], ['?', 'Show these keys'], ['Escape', 'Back to the list']]

export const keyAction = (e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey?: boolean; repeat?: boolean; target: unknown }): InboxKey | null => {
  const t = e.target as { tagName?: string; isContentEditable?: boolean; closest?: (s: string) => unknown } | null
  if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName ?? '') || t?.isContentEditable || t?.closest?.('[role=dialog]')) return null
  const key = KEYS[e.key]
  if (e.repeat && key !== 'next' && key !== 'prev') return null
  if (e.shiftKey && e.key.startsWith('Arrow')) return null
  return key ?? null
}

export const moveSelection = (ids: number[], current: number | null, dir: 1 | -1): number | undefined => {
  const at = current === null ? -1 : ids.indexOf(current)
  const to = at < 0 ? 0 : at + dir
  return to === at ? undefined : ids[to]
}

export const pinSelection = (shown: number | null, ids: number[], server: number | null): number | null => (shown !== null && ids.includes(shown) ? shown : server)

export const newRows = (known: number[], now: number[]): number[] => now.filter((id) => !known.includes(id))

const PAST: Partial<Record<DecisionOption['action'], string>> = { approvePlan: 'Plan approved', acceptStaging: 'Accepted on staging', approveProduction: 'Production approved', grantRound: 'One more round given', stopReview: 'Review stopped', backToBuild: 'Sent back to build', backToBacklog: 'Sent back to the backlog', requestChanges: 'Changes requested', expedite: 'Put on the fast lane', releaseLane: 'Fast lane released', rerun: 'Re-run started', approveSkill: 'Skill proposal approved', rejectSkill: 'Skill proposal rejected' }

export const announcement = (o: DecisionOption, number: number, next?: number): string =>
  `${PAST[o.action] ?? `${o.label} done`} for #${number}.${next ? ` Next: #${next}.` : ''}`

export const actionBar = (options: DecisionOption[], open: number, ticket: number, need?: string): { primary: DecisionOption | null; secondary: DecisionOption[]; answer: { label: string; href: string } | null } => {
  const rest = options.filter((o) => !(o.action === 'open' && o.href?.includes('?view=conversation')))
  const href = `/tickets/${ticket}?view=conversation`
  const answer = open > 0 ? { label: `Answer ${open} question${open === 1 ? '' : 's'}`, href } : need === 'Answer questions' ? { label: 'Answer questions', href } : null
  const primary = rest.find((o) => o.primary) ?? null
  return { primary, secondary: rest.filter((o) => o !== primary), answer }
}

export type PaneState = { gone: number[]; settled: number[]; failed: { item: InboxItem; error: string; at: number | null } | null }
export const emptyPane: PaneState = { gone: [], settled: [], failed: null }

const rowsLeft = (groups: InboxGroup[], gone: number[]): InboxGroup[] => groups.map((g) => ({ ...g, items: g.items.filter((i) => !gone.includes(i.id)) }))

export const removeRow = (s: PaneState, groups: InboxGroup[], id: number): { state: PaneState; next: InboxItem | undefined } => {
  const nextId = nextRow(rowsLeft(groups, s.gone), id)
  return { state: { ...s, gone: s.gone.includes(id) ? s.gone : [...s.gone, id], failed: null }, next: groups.flatMap((g) => g.items).find((i) => i.id === nextId) }
}

export const settleRow = (s: PaneState, id: number): PaneState => ({ ...s, settled: [...s.settled, id] })

export const syncRows = (s: PaneState): PaneState => (s.settled.length ? { ...s, gone: s.gone.filter((id) => !s.settled.includes(id)), settled: [] } : s)

export const restoreRow = (s: PaneState, item: InboxItem, error: string, selection: number | null, advancedTo: number | null): { state: PaneState; goTo: number | undefined } => ({
  state: { ...s, gone: s.gone.filter((id) => id !== item.id), failed: { item, error, at: selection } },
  goTo: selection === advancedTo ? item.id : undefined,
})

export const selectionChanged = (s: PaneState, selection: number | null): PaneState => (s.failed && selection !== s.failed.at && selection !== s.failed.item.id ? { ...s, failed: null } : s)
