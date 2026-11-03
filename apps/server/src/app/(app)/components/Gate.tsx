import type { ReactNode } from 'react'
import { requestChangesAction } from '../lib/actions'
import { isWebUrl } from '../lib/url'
import { Markdown } from './Markdown'
import { SubmitButton } from './SubmitButton'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card } from './ui/card'

type GateProps = {
  number: number
  plan: { title: string; steps: number } | null
  /** Admin-only: cost and model names stay out of the owner's view. */
  budget?: string
  model?: string
  sheet: string
}

const Shell = ({ title, meta, children }: { title: string; meta: ReactNode; children?: ReactNode }) => (
  <Card asChild className="max-w-[640px] scroll-mt-[calc(72px+var(--space-4))] gap-4 p-6">
    <section id="details" aria-labelledby="gate">
      <div>
        <h2 className="heading" id="gate">{title}</h2>
        <p className="small text-muted-foreground">{meta}</p>
      </div>
      {children}
    </section>
  </Card>
)

export function Gate({ number, plan, budget, model, sheet }: GateProps) {
  return (
    <Shell title="Approve plan" meta={`#${number} · plan`}>
      <dl className="body m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 [&_dd]:m-0 [&_dd]:min-w-0 [&_dd]:break-words [&_dt]:text-muted-foreground">
        <dt>Approves</dt><dd>{plan ? `${plan.title} · ${plan.steps} ${plan.steps === 1 ? 'step' : 'steps'}` : 'Plan comment not readable, open it on the forge.'}</dd>
        {budget && <><dt>Budget</dt><dd className="mono">{budget}</dd></>}
        {model && <><dt>Model</dt><dd className="mono">{model}</dd></>}
        <dt>Decisions</dt><dd>{sheet}</dd>
      </dl>
      <p className="small text-muted-foreground">Approving starts the Build Run that writes the code and opens the MR.</p>
    </Shell>
  )
}

/** Triage holds the Ticket: the decision sheet below is the action; the last answer moves the Ticket to plan. */
export function QuestionsGate({ number, answered, total }: { number: number; answered: number; total: number }) {
  return (
    <Shell title="Answer questions" meta={`#${number} · triage`}>
      <p className="body">Triage needs your answers before this Ticket can be planned. {answered} of {total} answered; saving the last critical answer moves the Ticket to plan, where the plan is written.</p>
    </Shell>
  )
}

type ReleaseGateProps = { ticket: number; number: number; title: string; timedOut: boolean; summaryHtml: string | null; stagingUrl: string | null }

export function ReleaseGate({ ticket, number, title, timedOut, summaryHtml, stagingUrl }: ReleaseGateProps) {
  return (
    <Shell title={title} meta={`#${number} · Staging`}>
      {timedOut && <p className="body">The deploy was not observed on staging within 60 minutes. Check staging yourself; you can still accept.</p>}
      {summaryHtml && <Markdown html={summaryHtml} />}
      {isWebUrl(stagingUrl) && <p><Button asChild variant="outline"><a href={stagingUrl}>Open staging</a></Button></p>}
      <p className="small text-muted-foreground">Accepting confirms the change works on staging; the Ticket then moves on (to production approval if that is on, otherwise to done).</p>
      <form action={requestChangesAction} className="flex scroll-mt-[calc(72px+var(--space-4))] flex-col items-start gap-4" id="changes">
        <input type="hidden" name="ticket" value={ticket} />
        <label className="flex flex-col gap-1 self-stretch">
          <span className="label text-muted-foreground">What needs to change</span>
          <textarea className="rounded-md border border-border bg-secondary px-3 py-2 text-[15px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring" name="note" required rows={3} />
        </label>
        <SubmitButton>Request changes</SubmitButton>
      </form>
    </Shell>
  )
}

export function ProductionChecksGate({ number, title }: { number: number; title: string }) {
  return (
    <Shell title={title} meta={`#${number} · Production`}>
      <p className="body">The production gate is on, but this Product has no production checks, so no deploy can be observed. Set them to continue; the Ticket then waits for production approval.</p>
    </Shell>
  )
}

export function ProductionGate({ number, title, failed }: { number: number; title: string; failed: boolean }) {
  return (
    <Shell title={title} meta={`#${number} · Production`}>
      <p className="body">{failed ? 'The production deploy failed or was not reported within 60 minutes. See the production Comment on the forge; approving again retries it.' : "Approving lets the Product's own pipeline deploy this Ticket to production; Bauherr then watches the production checks and closes the Ticket when they pass."}</p>
    </Shell>
  )
}

export function ReviewCapGate({ number, title, findingsHtml }: { number: number; title: string; findingsHtml: string | null }) {
  return (
    <Shell title={title} meta={`#${number} · review`}>
      <p className="body">The review sent this Ticket back to Build more often than allowed. The MR stays open either way.</p>
      {findingsHtml && <Markdown html={findingsHtml} />}
    </Shell>
  )
}

export function RerunGate({ run, number, title, stage }: { run: number; number: number; title: string; stage: string }) {
  return <Shell title={title} meta={<>#{number} · {stage} · <a className="text-primary" href={`/runs/${run}`}>Run {run}</a></>} />
}

export function Approved({ number, label = 'Plan approved' }: { number: number; label?: string }) {
  return (
    <Card asChild className="max-w-[640px] gap-4 p-6">
      <section aria-label={label}>
        <p className="body"><Badge variant="ok">✓ {label}</Badge> <span className="small text-muted-foreground">#{number}</span></p>
      </section>
    </Card>
  )
}
