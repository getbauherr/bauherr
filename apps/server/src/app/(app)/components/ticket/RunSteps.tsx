import type { RunPage } from '../../../../core/views/run'
import { Time } from '../Time'
import { Card, Section } from './Section'

const STEP = 'grid grid-cols-[64px_minmax(0,1fr)] gap-3 border-t border-border py-2 first:border-t-0'

const handoffText = (run: RunPage): string | null => {
  if (run.status === 'claimed') return 'Not written yet. The run is still working.'
  if (run.status === 'queued') return 'Not written yet. The run has not started.'
  if (run.handoff !== null) return null
  return run.status === 'failed' ? `The run failed: ${run.error ?? 'no reason given'}` : 'This run wrote no handoff.'
}

const stepsEmpty = (run: RunPage): string =>
  run.status === 'queued'
    ? 'The run waits for an agent.'
    : 'The agent has not reported a step yet.'

export function RunSteps({ run }: { run: RunPage }) {
  const handoff = handoffText(run)
  return (
    <Card>
      <Section title="Reported steps">
        {run.steps.length === 0 && <p className="text-muted-foreground">{stepsEmpty(run)}</p>}
        <ol className="m-0 grid list-none p-0">
          {run.steps.map((step) => (
            <li key={`${step.at}-${step.text}`} className={STEP}>
              <Time iso={step.at} className="mono text-muted-foreground" />
              <span>{step.text}</span>
            </li>
          ))}
        </ol>
      </Section>
      <Section title="Handoff, written at the end of the run">
        {handoff === null ? (
          <pre className="mono m-0 whitespace-pre-wrap rounded-md bg-secondary p-3">{run.handoff}</pre>
        ) : (
          <p className="text-muted-foreground">{handoff}</p>
        )}
      </Section>
    </Card>
  )
}
