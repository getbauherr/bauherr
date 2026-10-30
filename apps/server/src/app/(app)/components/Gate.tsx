import { acceptStagingAction, approvePlanAction, rerunStage, requestChangesAction } from '../lib/actions'
import { isWebUrl } from '../lib/url'
import { SubmitButton } from './SubmitButton'

type GateProps = {
  ticket: number
  number: number
  plan: { title: string; steps: number }
  budget: string
  model: string
  sheet: string
  blocked: string | null
}

export function Gate({ ticket, number, plan, budget, model, sheet, blocked }: GateProps) {
  return (
    <section className="gate" aria-labelledby="gate">
      <div>
        <h2 className="heading" id="gate">Approve plan</h2>
        <p className="small muted">#{number} · plan</p>
      </div>
      <dl className="body">
        <dt>Approves</dt><dd>{plan.title} · {plan.steps} {plan.steps === 1 ? 'step' : 'steps'}</dd>
        <dt>Budget</dt><dd className="mono">{budget}</dd>
        <dt>Model</dt><dd className="mono">{model}</dd>
        <dt>Decisions</dt><dd>{sheet}</dd>
      </dl>
      <form action={approvePlanAction}>
        <input type="hidden" name="ticket" value={ticket} />
        <SubmitButton className="btn primary" disabled={!!blocked}>Approve plan</SubmitButton>
        {blocked && <span className="small muted">{blocked}</span>}
      </form>
    </section>
  )
}

type ReleaseGateProps = { ticket: number; number: number; title: string; timedOut: boolean; summaryHtml: string | null; stagingUrl: string | null }

export function ReleaseGate({ ticket, number, title, timedOut, summaryHtml, stagingUrl }: ReleaseGateProps) {
  return (
    <section className="gate" aria-labelledby="gate">
      <div>
        <h2 className="heading" id="gate">{title}</h2>
        <p className="small muted">#{number} · release</p>
      </div>
      {timedOut && <p className="body">The deploy was not observed on staging within 60 minutes. Check staging yourself; you can still accept.</p>}
      {summaryHtml && <div className="md" dangerouslySetInnerHTML={{ __html: summaryHtml }} />}
      {isWebUrl(stagingUrl) && <p><a className="btn" href={stagingUrl}>Open staging</a></p>}
      <form action={acceptStagingAction}>
        <input type="hidden" name="ticket" value={ticket} />
        <SubmitButton className="btn primary">Accept</SubmitButton>
      </form>
      <form action={requestChangesAction} className="changes">
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

export function RerunGate({ run, number, title, stage }: { run: number; number: number; title: string; stage: string }) {
  return (
    <section className="gate" aria-labelledby="gate">
      <div>
        <h2 className="heading" id="gate">{title}</h2>
        <p className="small muted">#{number} · {stage} · <a className="link" href={`/runs/${run}`}>Run {run}</a></p>
      </div>
      <form action={rerunStage.bind(null, run)}>
        <SubmitButton className="btn primary">{`Re-run ${stage}`}</SubmitButton>
      </form>
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

