import { cn } from '@/lib/utils'
import type { ClosedAs } from '../../../core/views/rows'
import type { TicketStatus } from '../../../core/views/status'
import { CLOSED_WORDS, STATUS_WORDS } from '../lib/status-words'
import { Clock } from './icons'
import { Badge } from './ui/badge'

const MARKS = { check: '✓', cross: '×' } as const
const SPINNER = cn(
  'size-3 shrink-0 animate-[spin_1.6s_linear_infinite] rounded-full',
  'border-[1.5px] border-border border-t-primary motion-reduce:animate-none',
)

export function StatusChip({ status, closedAs }: { status: TicketStatus; closedAs?: ClosedAs | null }) {
  const { tone, mark, ...base } = STATUS_WORDS[status]
  const word = closedAs ? CLOSED_WORDS[closedAs] : base.word
  return (
    <Badge variant={tone} className="max-w-full whitespace-normal">
      {tone === 'accent' && <span className={SPINNER} />}
      {mark === 'clock' && <Clock className="size-3" />}
      {mark === 'check' || mark === 'cross' ? `${MARKS[mark]} ${word}` : word}
    </Badge>
  )
}
