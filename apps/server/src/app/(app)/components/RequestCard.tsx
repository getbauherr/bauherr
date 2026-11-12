import Link from 'next/link'
import type { FC, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { CardData } from '../../../lib/intake/card'
import { KIND_LABEL, PROBLEM, WHERE } from '../../../lib/intake/kinds'
import { Badge } from './ui/badge'

const Read: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
  <div className="flex flex-col gap-0.5">
    <span className="text-[12px] text-muted-foreground">{label}</span>
    <span className="text-[14px] leading-5 wrap-anywhere whitespace-pre-line">{children}</span>
  </div>
)

/** The request card as the request page shows it: read-only (a draft is edited in its conversation). */
export const RequestCard: FC<{ card: CardData }> = ({ card }) => (
  <section aria-label="Request card" data-testid="request-card" data-kind={card.kind} data-urgency={card.urgency} data-state={card.sent ? 'sent' : 'read'} className={cn('flex flex-col gap-3 rounded-md border bg-card p-3 text-card-foreground')}>
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="accent" data-testid="card-kind">{KIND_LABEL[card.kind]}</Badge>
      {card.urgency === 'urgent' && <Badge variant="destructive" data-testid="card-urgent">Urgent</Badge>}
      {card.followUp && <Badge variant="neutral">Follow-up to #{card.followUp}</Badge>}
      {card.sent && <Badge variant="ok">Sent</Badge>}
    </div>
    <div className="flex flex-col gap-2" data-testid="card-read">
      <Read label="Title">{card.title || 'Untitled request'}</Read>
      <Read label="Product">{card.product?.name ?? '—'}</Read>
      {card.urgency === 'urgent' && <Read label="Urgent: what is broken, for whom, since when">{card.urgentReason}</Read>}
      <Read label={PROBLEM[card.kind]}>{card.problem || '—'}</Read>
      {card.kind !== 'question' && card.context && <Read label={WHERE[card.kind]}>{card.context}</Read>}
      {card.kind !== 'question' && !!card.criteria.length && (
        <div className="flex flex-col gap-0.5">
          <span className="text-[12px] text-muted-foreground">It is done when</span>
          <ul className="m-0 pl-5 text-[14px] leading-5">{card.criteria.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
      )}
    </div>
    {!!card.images.length && (
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">Screenshots</span>
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" data-testid="card-images">
          {card.images.map((m) => (
            <li key={m.id} className="size-16 overflow-hidden rounded-md border bg-secondary">
              <a href={m.url} target="_blank" rel="noreferrer" aria-label={`Open ${m.name}`}><img src={m.url} alt={m.name} className="size-full object-cover" /></a>
            </li>
          ))}
        </ul>
      </div>
    )}
    {card.sent && card.ticket && <p className="m-0 text-[13px] text-muted-foreground">Filed as <Link className="text-primary" href={`/requests/${card.session}`}>#{card.ticket}</Link>.</p>}
  </section>
)
