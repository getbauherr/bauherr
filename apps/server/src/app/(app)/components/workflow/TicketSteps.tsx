import Link from 'next/link'
import { duration } from '../../lib/format'
import type { Step, Steps } from '../../lib/steps'
import { Badge } from '../ui/badge'

const TONE = { working: 'accent', human: 'warn', ci: 'neutral', queued: 'muted', closed: 'ok' } as const
const when = (iso: string) => `${iso.slice(0, 16).replace('T', ' ')} UTC`

const Meta = ({ k, v }: { k: string; v: string | null }) => (v ? <><dt className="text-muted-foreground">{k}</dt><dd className="m-0 min-w-0 break-words">{v}</dd></> : null)

function StepRow({ s }: { s: Step }) {
  const r = s.run
  return (
    <li className="flex flex-col gap-1 border-t border-border py-2 first:border-t-0" data-testid="step" data-phase={s.phase}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Badge variant={TONE[s.phase as keyof typeof TONE] ?? 'neutral'}>{s.label}</Badge>
        <span className="mono small">{s.phase === 'closed' ? '' : duration(s.seconds)}</span>
        <span className="small text-muted-foreground" title={s.at}>{when(s.at)}</span>
        {r && <Link className="small text-primary" href={`/runs/${r.id}`}>Run #{r.id}</Link>}
        {s.ci?.url && <a className="small text-primary" href={s.ci.url}>Merge request and checks</a>}
      </div>
      {s.ci?.provider && <p className="small m-0 text-muted-foreground">Waiting on {s.ci.provider}</p>}
      {s.decision && <p className="small m-0" data-testid="step-decision">Decided: {s.decision.what}{s.decision.actor ? ` by ${s.decision.actor}` : ''}</p>}
      {r && (
        <dl className="small m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5" data-testid="step-run">
          <Meta k="Executor" v={r.executor} />
          <Meta k="Session" v={r.sessionLabel} />
          <Meta k="Client" v={r.client} />
          <Meta k="Model" v={r.model} />
          <Meta k="Provider" v={r.provider} />
          <Meta k="Mode" v={r.mode} />
          <Meta k="Outcome" v={[r.outcome, r.verdict && `review ${r.verdict}`].filter(Boolean).join(', ') || null} />
          <Meta k="Reason" v={r.reason} />
          <Meta k="Cost" v={r.cost} />
        </dl>
      )}
    </li>
  )
}

/** The Ticket's steps, newest first: one entry per stage visit with its phases, who ran them and how long each took; totals on top. */
export function TicketSteps({ steps }: { steps: Steps }) {
  const t = steps.totals
  const total = [['Lead time', t.lead], ['Waiting for you', t.human], ['In progress', t.working], ['Queued', t.queued], ['Waiting on CI', t.ci]] as const
  return (
    <div className="flex flex-col gap-4" data-testid="ticket-steps">
      <dl className="m-0 flex flex-wrap gap-x-8 gap-y-2" aria-label="Totals">
        {total.map(([k, v]) => <div key={k}><dt className="label text-muted-foreground">{k}</dt><dd className="mono m-0" data-testid={`total-${k.toLowerCase().replace(/ /g, '-')}`}>{duration(v)}</dd></div>)}
      </dl>
      {steps.visits.length ? (
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {[...steps.visits].reverse().map((v, i) => (
            <li key={`${v.stage}-${v.at}-${i}`} className="rounded-md border border-border bg-card p-3" data-testid="visit" data-stage={v.stage}>
              <h3 className="heading m-0 flex flex-wrap items-baseline gap-x-3">{v.title}<span className="mono small font-normal text-muted-foreground">{duration(v.seconds)}</span></h3>
              <ul className="m-0 mt-1 flex list-none flex-col p-0">{[...v.steps].reverse().map((s) => <StepRow key={s.id} s={s} />)}</ul>
            </li>
          ))}
        </ol>
      ) : (
        <p className="m-0 text-muted-foreground">No history recorded yet.</p>
      )}
    </div>
  )
}
