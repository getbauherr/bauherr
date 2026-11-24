import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Badge } from '../../ui/badge'

export function RecommendationCard({
  title,
  level,
  confidence,
  accepted,
  children,
  action,
}: {
  title: string
  level: string
  confidence: string
  accepted: boolean
  children: ReactNode
  action: ReactNode
}) {
  return (
    <article
      data-slot="recommendation-card"
      aria-label={title}
      className={cn('grid gap-2 rounded-2xl border bg-card p-4', accepted ? 'border-ok' : 'border-border')}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="m-0 text-base font-semibold">{title}</h3>
        <Badge variant="accent">{level}</Badge>
      </div>
      <div className="small grid gap-1 text-muted-foreground">{children}</div>
      <div className="flex items-center justify-between gap-3">
        <span className="small text-muted-foreground">{confidence} confidence</span>
        {action}
      </div>
    </article>
  )
}
