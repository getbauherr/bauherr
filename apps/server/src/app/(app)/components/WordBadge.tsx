import { cn } from '@/lib/utils'
import type { StatusWord } from '../lib/status-words'
import { Clock } from './icons'
import { Badge } from './ui/badge'

const MARKS = { check: '✓', cross: '×' } as const
const SPINNER = cn(
  'size-3 shrink-0 animate-[spin_1.6s_linear_infinite] rounded-full',
  'border-[1.5px] border-border border-t-primary motion-reduce:animate-none',
)

export function WordBadge({ word: { word, tone, mark } }: { word: StatusWord }) {
  return (
    <Badge variant={tone} className="max-w-full whitespace-normal">
      {tone === 'accent' && <span className={SPINNER} />}
      {mark === 'clock' && <Clock className="size-3" />}
      {mark === 'check' || mark === 'cross' ? `${MARKS[mark]} ${word}` : word}
    </Badge>
  )
}
