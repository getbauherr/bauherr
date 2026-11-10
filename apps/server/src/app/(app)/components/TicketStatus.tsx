import Link from 'next/link'
import type { TicketStatus as Status } from '../lib/status'
import { Badge } from './ui/badge'

/** The one status vocabulary (`lib/status.ts`) as a badge; `detail` and `who` follow as muted lines when asked for. */
export function TicketStatus({ s, title, detail = true, who = false, href }: { s: Status; title?: string; href?: string; detail?: boolean; who?: boolean | 'narrow' }) {
  return (
    <span className="flex flex-col items-start gap-0.5" data-testid="ticket-status" data-phase={s.phase}>
      <Badge variant={s.tone} title={title} data-status={s.phase}>{s.label}</Badge>
      {detail && s.detail && (href ? <Link href={href} className="small text-primary hover:underline" data-testid="status-detail">{s.detail}</Link> : <span className="small text-muted-foreground" data-testid="status-detail">{s.detail}</span>)}
      {who && s.who && <span className={`small text-muted-foreground${who === 'narrow' ? ' @min-[960px]:hidden' : ''}`} data-testid="status-who">{s.who}</span>}
    </span>
  )
}
