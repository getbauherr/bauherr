import Link from 'next/link'
import { duration } from '../../lib/format'
import { rowsOf, type Row, type Steps } from '../../lib/steps'
import { Badge } from '../ui/badge'
import { RowDetail } from './RowDetail'

const TONE = { working: 'accent', human: 'warn', ci: 'neutral', queued: 'muted', closed: 'ok' } as const
const BAR = { working: 'bg-primary', human: 'bg-warn', ci: 'bg-muted-foreground', queued: 'bg-border', closed: 'bg-ok' } as Record<string, string>
const when = (iso: string) => `${iso.slice(0, 16).replace('T', ' ')} UTC`

const Meta = ({ k, v, href }: { k: string; v: string | null; href?: string }) => (v ? <><dt className="text-muted-foreground">{k}</dt><dd className="m-0 min-w-0 break-words">{href ? <Link className="text-primary" href={href}>{v}</Link> : v}</dd></> : null)

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

/** A row the Ticket has left shows its outcome (or "Done"); only the row the Ticket is in now shows where it stands (its latest phase). */
const badgeOf = (row: Row, current: boolean) => {
  const r = row.run
  const last = row.steps.at(-1)!
  if (current) return { text: last.label, tone: TONE[last.phase as keyof typeof TONE] ?? ('neutral' as const) }
  const text = [r?.outcome, r?.verdict && `review ${r.verdict}`].filter(Boolean).join(', ')
  const failed = r?.status === 'failed' || r?.status === 'budget_exhausted'
  return { text: failed ? 'Failed' : text ? cap(text) : 'Done', tone: failed ? ('destructive' as const) : ('ok' as const) }
}

/** `open`: the Ticket's decision while this row's latest phase is the one it waits at; it replaces "who decided" until someone has. */
function StepRow({ row, open, current }: { row: Row; open?: { ticket: number; ask: string } | null; current: boolean }) {
  const r = row.run
  const badge = badgeOf(row, current)
  const timed = row.steps.filter((s) => s.phase !== 'closed')
  const total = timed.reduce((n, s) => n + s.seconds, 0) || 1
  const decision = row.steps.find((s) => s.decision)?.decision
  const waiting = row.steps.find((s) => s.ci?.provider)
  const ci = row.steps.find((s) => s.ci?.url)?.ci?.url
  const version = row.steps.find((s) => s.workflowVersion != null)?.workflowVersion
  return (
    <li className="flex flex-col gap-1.5 border-t border-border py-3 first:border-t-0 first:pt-0 last:pb-0" data-testid="visit" data-stage={row.stage} data-phase={row.steps.at(-1)!.phase}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="heading m-0">{row.title}</h3>
        <Badge variant={badge.tone}>{badge.text}</Badge>
        <span className="mono small">{duration(row.seconds)}</span>
        <span className="small text-muted-foreground" title={row.at}>{when(row.at)}</span>
        {r && <Link className="small text-primary" href={`/runs/${r.id}`}>Run #{r.id}</Link>}
        {version != null && <span className="small text-muted-foreground" data-testid="step-workflow">workflow v{version}</span>}
        {ci && <a className="small text-primary" href={ci}>Merge request and checks</a>}
      </div>
      {r && (
        <p className="small m-0 flex flex-wrap items-baseline gap-x-2 text-muted-foreground" data-testid="step-run">
          <span>{r.executor}</span>
          {r.sessionLabel ? (
            <span className="text-foreground">{r.sessionId ? <Link className="text-primary" href={`/team#${r.sessionId}`}>{r.sessionLabel}</Link> : r.sessionLabel}{r.role && ` (${r.role})`}</span>
          ) : (
            r.role && <span className="text-foreground">{r.role}</span>
          )}
          {r.model && <span>· {r.model}</span>}
          {r.usage && <span className="mono">· {r.usage}</span>}
        </p>
      )}
      <div className="flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-secondary" role="img" aria-label={timed.map((s) => `${s.label} ${duration(s.seconds)}`).join(', ')} data-testid="phase-bar">
        {timed.map((s) => <span key={s.id} className={`${BAR[s.phase] ?? 'bg-border'} h-full min-w-1`} style={{ flexGrow: Math.max(s.seconds / total, 0.03) }} title={`${s.label} ${duration(s.seconds)}`} />)}
      </div>
      <p className="small m-0 text-muted-foreground" data-testid="phases">{timed.map((s) => `${s.label} ${duration(s.seconds)}`).join(' → ')}</p>
      {waiting && <p className="small m-0 text-muted-foreground">Waiting on {waiting.ci!.provider}</p>}
      {open && !decision && row.steps.at(-1)!.phase === 'human' && <p className="small m-0" data-testid="step-open-decision">{open.ask} <Link className="text-primary" href={`/inbox#t${open.ticket}`}>Decide in Inbox</Link></p>}
      {decision && <p className="small m-0" data-testid="step-decision">Decided: {decision.what}{decision.actor ? ` by ${decision.actor}` : ''}</p>}
      {r && (
        <RowDetail>
          <dl className="small m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5" data-testid="step-detail">
            <Meta k="Executor" v={r.executor} />
            <Meta k="Role" v={r.role} />
            <Meta k="Session" v={r.sessionLabel} href={r.sessionId ? `/team#${r.sessionId}` : undefined} />
            <Meta k="Client" v={r.client} />
            <Meta k="Model" v={r.model} />
            <Meta k="Provider" v={r.provider} />
            <Meta k="Mode" v={r.mode} />
            <Meta k="Outcome" v={[r.outcome, r.verdict && `review ${r.verdict}`].filter(Boolean).join(', ') || null} />
            <Meta k="Reason" v={r.reason} />
            <Meta k="Cost" v={r.cost} />
          </dl>
        </RowDetail>
      )}
    </li>
  )
}

/** The Ticket's steps, newest first: one row per Run (stage, outcome, duration, who ran it, model, cost) with its phases as one thin bar; the full executor data opens under "Details". */
export function TicketSteps({ steps, decision }: { steps: Steps; decision?: { ticket: number; ask: string } | null }) {
  const rows = steps.visits.flatMap(rowsOf).reverse()
  return rows.length ? (
    <ol className="m-0 flex list-none flex-col gap-0 rounded-md border border-border bg-card p-4 max-sm:p-3" data-testid="ticket-steps">
      {rows.map((row, i) => <StepRow key={`${row.stage}-${row.at}-${row.run?.id ?? i}`} row={row} open={i === 0 ? decision : null} current={i === 0 && row.stage === steps.path.current && row.steps.at(-1)!.phase !== 'closed'} />)}
    </ol>
  ) : (
    <p className="m-0 text-muted-foreground" data-testid="ticket-steps">No history recorded yet.</p>
  )
}
