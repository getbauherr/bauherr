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

/** Whether a row shows the unread dot: a local toggle (`u`, or opened for a second) wins over what the loader said. */
export const isUnseen = (i: { id: number; unseen?: boolean }, local: Record<number, boolean>): boolean => local[i.id] ?? !!i.unseen

/** Milliseconds a row stays open before its need counts as seen. */
export const SEEN_AFTER_MS = 1000

/** A key press that `u` may act on: not in a field, not with a modifier, not behind a dialog. */
export const toggleKey = (e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; target: unknown }): boolean => {
  const t = e.target as { tagName?: string; isContentEditable?: boolean; closest?: (s: string) => unknown } | null
  return e.key === 'u' && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName ?? '') && !t?.isContentEditable && !t?.closest?.('[role=dialog]')
}
