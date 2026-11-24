import type { ReactNode } from 'react'
import { Badge } from '../../ui/badge'

export function ApprovalCard({
  title,
  badge,
  body,
  details,
  decided,
  locked,
  actions,
}: {
  title: string
  badge: string
  body: string
  details: string[]
  decided: string | null
  locked: boolean
  actions: ReactNode
}) {
  return (
    <article
      data-slot="approval-card"
      aria-label={title}
      className="grid gap-2 rounded-2xl border border-border bg-card p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="m-0 text-base font-semibold">{title}</h3>
        <Badge>{badge}</Badge>
      </div>
      <p className="m-0">{body}</p>
      <ul className="small m-0 grid list-none gap-0.5 p-0 text-muted-foreground">
        {details.map((detail) => (
          <li key={detail}>{detail}</li>
        ))}
      </ul>
      {decided && <p className="small m-0 text-muted-foreground">{decided}</p>}
      {!locked && <div className="flex gap-2">{actions}</div>}
    </article>
  )
}
