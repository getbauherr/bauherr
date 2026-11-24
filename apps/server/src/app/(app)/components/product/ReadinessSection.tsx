import Link from 'next/link'
import { describeChange } from '../../../../core/readiness/checks'
import type { ReadinessItem, ReadinessView } from '../../../../core/readiness/view'
import { Badge } from '../ui/badge'
import { Time } from '../Time'
import { CheckNow, SettingFix, TicketFix } from './ReadinessActions'

const MARK = {
  gap: { glyph: '✕', word: 'Gap', tone: 'text-destructive' },
  note: { glyph: 'i', word: 'Note', tone: 'text-muted-foreground' },
  unknown: { glyph: '?', word: 'Unknown', tone: 'text-muted-foreground' },
  ready: { glyph: '✓', word: 'Ready', tone: 'text-ok' },
} as const

const hours = (seconds: number): string =>
  seconds < 3600 ? `${Math.max(1, Math.round(seconds / 60))} min` : `${(seconds / 3600).toFixed(1)} h`

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

const ROW = 'grid items-start gap-3 border-t border-border px-4 py-3 first:border-t-0'
const LINK = 'text-primary underline underline-offset-2'

function Fix({ item, product, admin }: { item: ReadinessItem; product: number; admin: boolean }) {
  const { fix, ticket } = item
  if (fix === null || item.status !== 'gap') return null
  if (fix.kind === 'link') {
    return fix.href.startsWith('#') ? (
      <a href={fix.href} className={`small ${LINK}`}>{fix.label}</a>
    ) : (
      <Link href={fix.href} className={`small ${LINK}`}>{fix.label}</Link>
    )
  }
  if (fix.kind === 'ticket') {
    if (ticket === null) return <TicketFix product={product} check={item.id} label={fix.label} />
    const text = `Ticket #${ticket.number} open`
    return ticket.recordId === null ? (
      <span className="small text-muted-foreground">{text}</span>
    ) : (
      <Link href={`/tickets/${ticket.recordId}`} className={`small ${LINK}`}>{text}</Link>
    )
  }
  if (!admin) return null
  const { change } = fix
  return (
    <SettingFix
      product={product}
      check={item.id}
      setting={change.setting}
      label={fix.label}
      value={describeChange(change)}
    />
  )
}

function Row({ item, product, admin }: { item: ReadinessItem; product: number; admin: boolean }) {
  const mark = MARK[item.status]
  return (
    <li className={`${ROW} grid-cols-[1.75rem_minmax(0,1fr)_auto]`}>
      <span aria-hidden className={`text-center font-semibold ${mark.tone}`}>{mark.glyph}</span>
      <span className="grid gap-0.5">
        <span className="sr-only">{mark.word}: </span>
        <span className="font-medium">{item.title}</span>
        {item.detail !== '' && <span className="small text-muted-foreground">{item.detail}</span>}
      </span>
      <Fix item={item} product={product} admin={admin} />
    </li>
  )
}

function HeldUpCard({ view, product }: { view: ReadinessView; product: number }) {
  const { heldUp } = view
  return (
    <aside className="grid gap-2 rounded-md border border-border bg-card p-4">
      <h3 className="label text-muted-foreground">Held up in 30 days</h3>
      {heldUp.tickets === 0 ? (
        <span className="small">No ticket waited on checks or on a session.</span>
      ) : (
        <>
          <span className="small">
            {plural(heldUp.tickets, 'ticket', 'tickets')}, {hours(heldUp.seconds)} waiting
          </span>
          <ul className="small m-0 grid list-disc gap-1 pl-5">
            <li>
              Waiting over an hour on checks: {plural(heldUp.checks.tickets, 'ticket', 'tickets')},{' '}
              {hours(heldUp.checks.seconds)}
            </li>
            <li>
              Queued with no agent: {plural(heldUp.queued.tickets, 'ticket', 'tickets')}, {hours(heldUp.queued.seconds)}
            </li>
          </ul>
        </>
      )}
      <Link href={`/insights?product=${product}&days=30`} className={`small ${LINK}`}>See on Insights</Link>
    </aside>
  )
}

export function ReadinessSection({ product, view, admin }: { product: number; view: ReadinessView; admin: boolean }) {
  const open = view.items.filter((item) => item.status !== 'ready')
  const ready = view.items.filter((item) => item.status === 'ready')
  return (
    <section id="readiness" aria-labelledby="readiness-title" className="grid scroll-mt-4 gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="readiness-title" className="heading">Readiness</h2>
        {view.gaps === 0 ? (
          <Badge variant="ok">No gaps</Badge>
        ) : (
          <Badge variant="warn">{plural(view.gaps, 'gap', 'gaps')}</Badge>
        )}
        <span className="small ml-auto flex flex-wrap items-baseline gap-2 text-muted-foreground">
          {view.checkedAt === null ? 'Not checked yet' : <>Checked <Time iso={view.checkedAt} /></>}
          {admin && <><span aria-hidden>·</span><CheckNow product={product} /></>}
        </span>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <ul className="m-0 list-none overflow-hidden rounded-md border border-border bg-card p-0">
          {open.map((item) => <Row key={item.id} item={item} product={product} admin={admin} />)}
          {ready.length > 0 && (
            <li className={`${ROW} grid-cols-[1.75rem_minmax(0,1fr)]`}>
              <span aria-hidden className="text-center font-semibold text-ok">✓</span>
              <span>
                <span className="font-medium">Ready:</span> {ready.map((item) => item.title).join(', ')}
              </span>
            </li>
          )}
        </ul>
        <HeldUpCard view={view} product={product} />
      </div>
    </section>
  )
}
