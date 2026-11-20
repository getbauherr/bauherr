import type { ClosedAs } from '../../../core/views/rows'
import type { TicketStatus } from '../../../core/views/status'
import { CLOSED_WORDS, STATUS_WORDS } from '../lib/status-words'
import { WordBadge } from './WordBadge'

export function StatusChip({ status, closedAs }: { status: TicketStatus; closedAs?: ClosedAs | null }) {
  const base = STATUS_WORDS[status]
  return <WordBadge word={closedAs ? { ...base, word: CLOSED_WORDS[closedAs] } : base} />
}
