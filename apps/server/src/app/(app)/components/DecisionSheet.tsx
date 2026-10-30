import { answerDecisions } from '../lib/actions'
import type { Decision } from '../lib/plan'

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
                        <label key={o} className="opt small">
                          <input type="radio" name={d.id} value={o} defaultChecked={answers[d.id] === o} />
                          {o}
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
            <button type="submit" className="btn">Save answers</button>
          </footer>
        </form>
      </div>
    </section>
  )
}
