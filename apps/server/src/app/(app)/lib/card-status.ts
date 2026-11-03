import { activity, heartbeatAge } from './format'
import type { TicketRow } from './overview'

/** The one-word statuses a Board card can carry; shared with the Runs table (#259). Needs-you is a verb and not listed. */
export const CARD_STATUSES = ['Working', 'Blocked', 'Waiting'] as const
export type CardStatus = (typeof CARD_STATUSES)[number]

type Input = Pick<TicketRow, 'run' | 'owner' | 'blockedBy' | 'waiting'>

/**
 * The single status of a card, first match: Working (latest Run live), Blocked, Waiting.
 * `word` is the activity shown for a running Run ("building"); `tip` holds the detail hidden from the card (stage, who, heartbeat, blocker ids).
 */
export function cardStatus(t: Input, now = Date.now()): { status: CardStatus; word: string | null; tip: string } | null {
  const r = t.run
  if (r && (r.status === 'running' || r.status === 'awaiting_session')) {
    const at = r.heartbeatAt ?? r.startedAt
    const who = r.mode === 'session' ? (t.owner ?? 'session') : 'scheduler'
    return { status: 'Working', word: activity({ run: r }), tip: [`${r.stage} Run #${r.id}`, who, at && heartbeatAge(at, now).text].filter(Boolean).join(' · ') }
  }
  if (t.blockedBy.length) return { status: 'Blocked', word: null, tip: `Blocked by ${t.blockedBy.map((b) => `#${b.number}`).join(', ')}` }
  if (t.waiting) return { status: 'Waiting', word: null, tip: t.waiting }
  return null
}

/** Text elements a card shows besides its muted number: title, status or needs-you verb, epic tag, and the Product when room is left. */
export function showsProduct(t: { needsYou: string | null; parent: unknown }, hasStatus: boolean, productVisible: boolean): boolean {
  return productVisible && 1 + Number(t.needsYou !== null || hasStatus) + Number(t.parent !== null) < (t.needsYou ? 4 : 3)
}
