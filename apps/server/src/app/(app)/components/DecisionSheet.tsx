import { answerDecisions } from '../lib/actions'
import type { Decision } from '../lib/plan'
import { SubmitButton } from './SubmitButton'
import { Card } from './ui/card'
import { Table } from './ui/table'

export function DecisionSheet({ ticket, decisions, answers }: { ticket: number; decisions: Decision[]; answers: Record<string, string> }) {
  return (
    <section className="flex scroll-mt-[calc(72px+var(--space-4))] flex-col gap-4" id="decisions" aria-labelledby="decisions-h">
      <h2 className="heading" id="decisions-h">Decisions</h2>
      <Card className="sheet max-w-[640px] gap-0 overflow-hidden p-0">
        <form className="flex flex-col" action={answerDecisions}>
          <input type="hidden" name="ticket" value={ticket} />
          <Table className="border-0 [&_td]:align-top [&_tbody_tr]:transition-colors [&_tbody_tr]:duration-(--duration-state) [&_tbody_tr:hover]:bg-accent">
            <thead>
              <tr className="label text-muted-foreground"><th>#</th><th>Decision</th><th>Default</th></tr>
            </thead>
            <tbody>
              {decisions.map((d) => (
                <tr key={d.id}>
                  <td className="mono">{d.id}</td>
                  <td>
                    <fieldset className="m-0 mt-2 flex flex-col gap-1 border-0 p-0">
                      <legend className="body p-0">{d.title}</legend>
                      {d.critical && <span className="label text-warn">★ critical</span>}
                      {d.options.map((o) => (
                        <label key={o} className="small flex cursor-pointer items-center gap-2 rounded-sm px-1 data-[answered]:ring-2 data-[answered]:ring-primary" data-answered={answers[d.id] === o || undefined}>
                          <input className="accent-primary" type="radio" name={d.id} value={o} defaultChecked={answers[d.id] === o} />
                          {d.options.length > 1 ? o : 'Accept the default'}
                        </label>
                      ))}
                    </fieldset>
                  </td>
                  <td className="mono">{d.default}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-border px-4 py-3">
            <span className="small text-muted-foreground">Unanswered rows take their default.</span>
            <SubmitButton>Save answers</SubmitButton>
          </footer>
        </form>
      </Card>
    </section>
  )
}
