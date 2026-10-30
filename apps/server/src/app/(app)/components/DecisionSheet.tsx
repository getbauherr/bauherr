import { answerDecisions } from '../lib/actions'
import type { Decision } from '../lib/plan'
import { SubmitButton } from './SubmitButton'

export function DecisionSheet({ ticket, decisions, answers }: { ticket: number; decisions: Decision[]; answers: Record<string, string> }) {
  return (
    <section className="stack" aria-labelledby="decisions">
      <h2 className="heading" id="decisions">Decisions</h2>
      <div className="sheet">
        <form action={answerDecisions}>
          <input type="hidden" name="ticket" value={ticket} />
          <table className="table">
            <thead>
              <tr className="label muted"><th>#</th><th>Decision</th><th>Default</th></tr>
            </thead>
            <tbody>
              {decisions.map((d) => (
                <tr key={d.id}>
                  <td className="mono">{d.id}</td>
                  <td>
                    <fieldset>
                      <legend className="body">{d.title}</legend>
                      {d.critical && <span className="label crit">★ critical</span>}
                      {d.options.map((o) => (
                        <label key={o} className="opt small" data-answered={answers[d.id] === o || undefined}>
                          <input type="radio" name={d.id} value={o} defaultChecked={answers[d.id] === o} />
                          {d.options.length > 1 ? o : 'Accept the default'}
                        </label>
                      ))}
                    </fieldset>
                  </td>
                  <td className="mono">{d.default}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <footer>
            <span className="small muted">Unanswered rows take their default.</span>
            <SubmitButton>Save answers</SubmitButton>
          </footer>
        </form>
      </div>
    </section>
  )
}
