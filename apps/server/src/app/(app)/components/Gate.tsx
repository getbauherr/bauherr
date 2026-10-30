import { approvePlanAction } from '../lib/actions'

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
        <button type="submit" className="btn primary" disabled={!!blocked}>Approve plan</button>
        {blocked && <span className="small muted">{blocked}</span>}
      </form>
    </section>
  )
}

export function Approved({ number }: { number: number }) {
  return (
    <section className="gate" aria-label="Plan approved">
      <p className="body"><span className="chip label succeeded">✓ Plan approved</span> <span className="small muted">#{number}</span></p>
    </section>
  )
}

