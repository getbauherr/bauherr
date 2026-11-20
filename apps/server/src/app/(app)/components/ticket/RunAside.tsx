import type { RunPage } from '../../../../core/views/run'
import { duration, usd } from '../../lib/format'
import { CARD } from './Section'

const secondsOf = (run: RunPage): number =>
  (Date.parse(run.finishedAt ?? new Date().toISOString()) - Date.parse(run.startedAt)) / 1000

export function RunAside({ run, admin }: { run: RunPage; admin: boolean }) {
  return (
    <div className="grid content-start gap-4">
      <section className={`${CARD} grid gap-2 p-4`}>
        <h3 className="label m-0 text-muted-foreground">Context given to the agent</h3>
        {run.parts.map((part) => (
          <span key={part.label} className="small">{part.label}: <span className="mono">{part.detail}</span></span>
        ))}
      </section>
      {admin && (
        <section className={`${CARD} grid gap-2 p-4`}>
          <h3 className="label m-0 text-muted-foreground">
            {run.finishedAt ? 'Cost' : 'Cost so far'} <span className="normal-case tracking-normal">(Admin)</span>
          </h3>
          <span className="mono">{usd(run.costUsd)} · {duration(secondsOf(run))}</span>
        </section>
      )}
    </div>
  )
}
