import type { RunPage } from '../../../../core/views/run'
import { duration, kilobytes, usd } from '../../lib/format'
import { RunLinks } from './RunLinks'
import { CARD } from './Section'

const secondsOf = (run: RunPage): number =>
  (Date.parse(run.finishedAt ?? new Date().toISOString()) - Date.parse(run.startedAt)) / 1000

const PANEL = `${CARD} grid gap-2 p-4`

export function RunAside({ run, admin }: { run: RunPage; admin: boolean }) {
  return (
    <div className="grid content-start gap-4">
      <RunLinks run={run} />
      {admin && (
        <section className={PANEL}>
          <h2 className="label m-0 text-muted-foreground">
            {run.finishedAt ? 'Cost' : 'Cost so far'} <span className="normal-case tracking-normal">(Admin)</span>
          </h2>
          <span className="mono">{usd(run.costUsd)} · {duration(secondsOf(run))}</span>
        </section>
      )}
      <section className={PANEL}>
        <h2 className="label m-0 text-muted-foreground">Context given to the agent</h2>
        {run.parts.map((part) => (
          <span key={part.label} className="small">{part.label}: <span className="mono">{part.detail}</span></span>
        ))}
      </section>
      {run.attachments.length > 0 && (
        <section className={PANEL}>
          <h2 className="label m-0 text-muted-foreground">Attachments</h2>
          {run.attachments.map((attachment) => (
            <span key={attachment.id} className="small">
              {attachment.caption} <span className="mono">{kilobytes(attachment.bytes)}</span>
            </span>
          ))}
        </section>
      )}
    </div>
  )
}
