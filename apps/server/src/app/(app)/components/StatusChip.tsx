import { cn } from '@/lib/utils'
import type { TicketStatus } from '../../../core/views/status'
import { STATUS_WORDS } from '../lib/status-words'
import { Clock } from './icons'
import { Badge } from './ui/badge'

const MARKS = { check: '✓', cross: '×' } as const
const SPINNER = cn(
  'size-3 shrink-0 animate-[spin_1.6s_linear_infinite] rounded-full',
  'border-[1.5px] border-border border-t-primary motion-reduce:animate-none',
)

export function StatusChip({ status }: { status: TicketStatus }) {
  const { word, tone, mark } = STATUS_WORDS[status]
  return (
    <Badge variant={tone} className="max-w-full whitespace-normal">
      {tone === 'accent' && <span className={SPINNER} />}
      {mark === 'clock' && <Clock className="size-3" />}
      {(mark === 'check' || mark === 'cross') && <span aria-hidden>{MARKS[mark]}</span>}
      {word}
    </Badge>
  )
}
