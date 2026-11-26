import type { StatusWord } from '../lib/status-words'
import { Clock } from './icons'
import { LiveDot } from './LiveDot'
import { Badge } from './ui/badge'

const MARKS = { check: '✓', cross: '×' } as const

export function WordBadge({ word: { word, tone, mark } }: { word: StatusWord }) {
  return (
    <Badge variant={tone} className="max-w-full whitespace-normal">
      {tone === 'accent' && <LiveDot />}
      {mark === 'clock' && <Clock className="size-3" />}
      {mark === 'check' || mark === 'cross' ? `${MARKS[mark]} ${word}` : word}
    </Badge>
  )
}
