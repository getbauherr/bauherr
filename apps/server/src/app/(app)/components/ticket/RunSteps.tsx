import type { RunPage } from '../../../../core/views/run'
import { Time } from '../Time'
import { Card, Section } from './Section'
import { RefText } from '../RefText'

const STEP =
  'grid grid-cols-1 gap-1 border-t border-border py-2 first:border-t-0 sm:grid-cols-[112px_minmax(0,1fr)] sm:gap-3'

const HANDOFF = 'mono m-0 whitespace-pre-wrap rounded-md bg-secondary p-3 [overflow-wrap:anywhere]'

const handoffText = (run: RunPage): string | null => {
  if (run.status === 'claimed') return 'Not written yet. The run is still working.'
  if (run.status === 'queued') return 'Not written yet. The run has not started.'
  if (run.handoff !== null) return null
  if (run.status === 'failed' || run.status === 'expired') {
    return `The run ${run.status}: ${run.error ?? 'no reason given'}`
  }
  return 'This run wrote no handoff.'
}

const emptyText = (run: RunPage): string => {
  if (run.status === 'queued') return 'No step yet. The run has not started.'
  if (run.status === 'claimed') {
    const minutes = Math.max(0, Math.round((Date.now() - Date.parse(run.startedAt)) / 60_000))
    return `The agent has not reported a step yet. It started ${minutes} min ago.`
  }
  return 'The agent reported no step.'
}

export function RunSteps({ run }: { run: RunPage }) {
  const handoff = handoffText(run)
  return (
    <Card>
      <Section title="Reported steps">
        {run.steps.length === 0 && <p className="m-0 text-muted-foreground">{emptyText(run)}</p>}
        <ol className="m-0 grid list-none p-0">
          {run.steps.map((step) => (
            <li key={`${step.at}-${step.text}`} className={STEP}>
              <Time iso={step.at} className="mono text-muted-foreground" />
              <span className="[overflow-wrap:anywhere]"><RefText text={step.text} repo={run.ticket.repo} /></span>
            </li>
          ))}
        </ol>
      </Section>
      <Section title="Handoff, written at the end of the run">
        {handoff === null ? (
          <pre className={HANDOFF}><RefText text={run.handoff ?? ''} repo={run.ticket.repo} /></pre>
        ) : (
          <p className="m-0 [overflow-wrap:anywhere] text-muted-foreground">{handoff}</p>
        )}
      </Section>
    </Card>
  )
}
