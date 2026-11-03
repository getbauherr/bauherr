import { requestChangesAction } from '../lib/actions'
import { isWebUrl } from '../lib/url'
import { SubmitButton } from './SubmitButton'

type GateProps = {
  number: number
  plan: { title: string; steps: number } | null
  budget: string
  model: string
  sheet: string
}

export function Gate({ number, plan, budget, model, sheet }: GateProps) {
  return (
    <section className="gate" id="details" aria-labelledby="gate">
      <div>
        <h2 className="heading" id="gate">Approve plan</h2>
        <p className="small muted">#{number} · plan</p>
      </div>
      <dl className="body">
        <dt>Approves</dt><dd>{plan ? `${plan.title} · ${plan.steps} ${plan.steps === 1 ? 'step' : 'steps'}` : 'Plan comment not readable, open it on the forge.'}</dd>
        <dt>Budget</dt><dd className="mono">{budget}</dd>
        <dt>Model</dt><dd className="mono">{model}</dd>
        <dt>Decisions</dt><dd>{sheet}</dd>
      </dl>
    </section>
  )
}

/** Triage holds the Ticket: the decision sheet below is the action; the last answer moves the Ticket to plan. */
export function QuestionsGate({ number, answered, total }: { number: number; answered: number; total: number }) {
  return (
    <section className="gate" id="details" aria-labelledby="gate">
      <div>
        <h2 className="heading" id="gate">Answer questions</h2>
        <p className="small muted">#{number} · triage</p>
      </div>
      <p className="body">Triage needs your answers before this Ticket can be planned. {answered} of {total} answered; saving the last critical answer moves the Ticket to plan.</p>
    </section>
  )
}

type ReleaseGateProps = { ticket: number; number: number; title: string; timedOut: boolean; summaryHtml: string | null; stagingUrl: string | null }

export function ReleaseGate({ ticket, number, title, timedOut, summaryHtml, stagingUrl }: ReleaseGateProps) {
  return (
    <section className="gate" id="details" aria-labelledby="gate">
      <div>
        <h2 className="heading" id="gate">{title}</h2>
        <p className="small muted">#{number} · Staging</p>
      </div>
      {timedOut && <p className="body">The deploy was not observed on staging within 60 minutes. Check staging yourself; you can still accept.</p>}
      {summaryHtml && <div className="md" dangerouslySetInnerHTML={{ __html: summaryHtml }} />}
      {isWebUrl(stagingUrl) && <p><a className="btn" href={stagingUrl}>Open staging</a></p>}
      <form action={requestChangesAction} className="changes" id="changes">
        <input type="hidden" name="ticket" value={ticket} />
        <label className="field">
          <span className="label muted">What needs to change</span>
          <textarea name="note" required rows={3} />
        </label>
        <SubmitButton className="btn">Request changes</SubmitButton>
      </form>
    </section>
  )
}

export function ProductionChecksGate({ number, title }: { number: number; title: string }) {
  return (
    <section className="gate" id="details" aria-labelledby="gate">
      <div>
        <h2 className="heading" id="gate">{title}</h2>
        <p className="small muted">#{number} · Production</p>
      </div>
      <p className="body">The production gate is on, but this Product has no production checks, so no deploy can be observed. Set them to continue; the Ticket then waits for production approval.</p>
    </section>
  )
}

export function ProductionGate({ number, title, failed }: { number: number; title: string; failed: boolean }) {
  return (
    <section className="gate" id="details" aria-labelledby="gate">
      <div>
        <h2 className="heading" id="gate">{title}</h2>
        <p className="small muted">#{number} · Production</p>
      </div>
      <p className="body">{failed ? 'The production deploy failed or was not reported within 60 minutes. See the production Comment on the forge; approving again retries it.' : "Approving lets the Product's own pipeline deploy this Ticket to production."}</p>
    </section>
  )
}

export function ReviewCapGate({ number, title, findingsHtml }: { number: number; title: string; findingsHtml: string | null }) {
  return (
    <section className="gate" id="details" aria-labelledby="gate">
      <div>
        <h2 className="heading" id="gate">{title}</h2>
        <p className="small muted">#{number} · review</p>
      </div>
      <p className="body">The review sent this Ticket back to Build more often than allowed. The MR stays open either way.</p>
      {findingsHtml && <div className="md" dangerouslySetInnerHTML={{ __html: findingsHtml }} />}
    </section>
  )
}

export function RerunGate({ run, number, title, stage }: { run: number; number: number; title: string; stage: string }) {
  return (
    <section className="gate" id="details" aria-labelledby="gate">
      <div>
        <h2 className="heading" id="gate">{title}</h2>
        <p className="small muted">#{number} · {stage} · <a className="link" href={`/runs/${run}`}>Run {run}</a></p>
      </div>
    </section>
  )
}

export function Approved({ number, label = 'Plan approved' }: { number: number; label?: string }) {
  return (
    <section className="gate" aria-label={label}>
      <p className="body"><span className="chip label succeeded">✓ {label}</span> <span className="small muted">#{number}</span></p>
    </section>
  )
}

