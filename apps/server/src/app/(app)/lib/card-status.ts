import { activity, heartbeatAge } from './format'
import type { TicketRow } from './overview'

export type CardStatus = 'Working' | 'Blocked' | 'Waiting'

/** The one-word status, first match: Working (latest Run live), Blocked, Waiting. Shared by the Board card and the Epics view. */
export const statusOf = (t: { run: { status: string } | null; blockedBy: unknown[]; waiting: string | null }): CardStatus | null =>
  t.run && ['running', 'awaiting_session'].includes(t.run.status) ? 'Working' : t.blockedBy.length ? 'Blocked' : t.waiting ? 'Waiting' : null

/**
 * `tip` is the detail hidden from the card: the activity word for Working (plus stage, Run id, who and heartbeat for admins only), blocker ids, the wait reason.
 */
export function cardStatus(t: Pick<TicketRow, 'run' | 'owner' | 'blockedBy' | 'waiting'>, admin: boolean, now = Date.now()): { status: CardStatus; tip: string } | null {
  const status = statusOf(t)
  if (status === 'Blocked') return { status, tip: `Blocked by ${t.blockedBy.map((b) => `#${b.number}`).join(', ')}` }
  if (status === 'Waiting') return { status, tip: t.waiting! }
  const r = t.run
  if (!status || !r) return null
  const at = r.heartbeatAt ?? r.startedAt
  const who = r.mode === 'session' ? (t.owner ?? 'session') : 'scheduler'
  return { status, tip: [activity({ run: r }) ?? 'Working', ...(admin ? [`${r.stage} Run #${r.id}`, who, at && heartbeatAge(at, now).text] : [])].filter(Boolean).join(' · ') }
}

/** Text elements a card shows besides its muted number: title, status or needs-you verb, epic tag, and the Product when room is left. */
export function showsProduct(t: { needsYou: string | null; parent: unknown }, hasStatus: boolean, productVisible: boolean): boolean {
  return productVisible && 1 + Number(t.needsYou !== null || hasStatus) + Number(t.parent !== null) < (t.needsYou ? 4 : 3)
}
