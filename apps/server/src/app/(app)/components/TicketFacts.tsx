import type { ReactNode } from 'react'
import { duration } from '../lib/format'
import type { Steps } from '../lib/steps'
import { Card } from './ui/card'

type Link = { label: string; href: string }

const Row = ({ k, children, id }: { k: string; children: ReactNode; id?: string }) => (
  <div className="flex items-baseline justify-between gap-4 border-t border-border py-1.5 first:border-t-0 first:pt-0 last:pb-0">
    <dt className="small text-muted-foreground">{k}</dt>
    <dd className="m-0 min-w-0 text-right break-words" data-testid={id}>{children}</dd>
  </div>
)

/** The Ticket page's right column: who and what the Ticket is, where its time went, and where to go next. Database values only. */
export function TicketFacts({ product, stage, totals, runs, models, executor, links }: { product: string; stage: string; totals: Steps['totals']; runs: number; models: string[]; executor: string | null; links: Link[] }) {
  const time = [['Lead time', totals.lead], ['In progress', totals.working], ['Waiting for you', totals.human], ['Queued', totals.queued], ['Waiting for CI', totals.ci]] as const
  return (
    <Card asChild className="gap-0 p-4">
      <section aria-label="Facts" data-testid="ticket-facts">
        <dl className="body m-0 flex flex-col">
          <Row k="Product">{product}</Row>
          <Row k="Stage">{stage}</Row>
          {time.filter(([k, v]) => k === 'Lead time' || v > 0).map(([k, v]) => <Row key={k} k={k} id={`total-${k.toLowerCase().replace(/ /g, '-')}`}><span className="mono">{v > 0 ? duration(v) : '—'}</span></Row>)}
          <Row k="Runs">{runs}</Row>
          {models.length > 0 && <Row k={models.length > 1 ? 'Models' : 'Model'}><span className="mono small">{models.join(', ')}</span></Row>}
          {executor && <Row k="Executor"><span className="small">{executor}</span></Row>}
        </dl>
        {links.length > 0 && (
          <ul className="small m-0 mt-3 flex list-none flex-wrap gap-x-4 gap-y-1 border-t border-border p-0 pt-3">
            {links.map((l) => <li key={l.href}><a className="text-primary" href={l.href} {...(/^https?:/.test(l.href) ? { target: '_blank', rel: 'noreferrer' } : {})}>{l.label}</a></li>)}
          </ul>
        )}
      </section>
    </Card>
  )
}
