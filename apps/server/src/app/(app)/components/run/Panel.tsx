import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Card } from '../ui/card'

/** One side panel: a card with an h2. */
export function Panel({ id, title, className, children }: { id: string; title: string; className?: string; children: ReactNode }) {
  return (
    <Card asChild className={cn('gap-2', className)}>
      <section aria-labelledby={id}>
        <h2 id={id} className="label text-muted-foreground">{title}</h2>
        {children}
      </section>
    </Card>
  )
}
