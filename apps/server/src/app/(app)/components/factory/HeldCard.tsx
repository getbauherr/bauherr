import { cn } from '@/lib/utils'
import type { HeldItem } from '../../../../core/intake/held'
import { HELD_SENTENCES } from '../../lib/status-words'
import { Badge } from '../ui/badge'

const CARD = 'relative grid min-w-0 justify-items-start gap-1.5 rounded-md border border-border bg-card px-3 py-2.5'
const LINK = cn("font-medium leading-5 after:absolute after:inset-0 after:content-['']")

export function HeldCard({ item }: { item: HeldItem }) {
  return (
    <div className={CARD}>
      <span className="mono" title={item.repo}>#{item.number}</span>
      <a href={item.url} target="_blank" rel="noopener noreferrer" className={LINK}>
        {item.title}
        <span className="sr-only"> (opens in new tab)</span>
      </a>
      <Badge>Held</Badge>
      <span className="small text-muted-foreground">{HELD_SENTENCES[item.reason] ?? item.reason}</span>
    </div>
  )
}
