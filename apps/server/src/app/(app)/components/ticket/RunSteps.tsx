import Link from 'next/link'
import type { RunPage } from '../../../../core/views/run'
import { Time } from '../Time'
import { Card, Section } from './Section'
import { RefText } from '../RefText'

const STEP = 'grid grid-cols-[112px_minmax(0,1fr)] gap-3 border-t border-border py-2 first:border-t-0'

const handoffText = (run: RunPage): string | null => {
  if (run.status === 'claimed') return 'Not written yet. The run is still working.'
  if (run.status === 'queued') return 'Not written yet. The run has not started.'
  if (run.handoff !== null) return null
  if (run.status === 'failed' || run.status === 'expired') {
    return `The run ${run.status}: ${run.error ?? 'no reason given'}`
  }
  return 'This run wrote no handoff.'
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
              <span><RefText text={step.text} repo={run.ticket.repo} /></span>
            </li>
          ))}
        </ol>
      </Section>
      {run.memory.length > 0 && (
        <Section title="Memory handed to this run">
          <ul className="m-0 grid list-none p-0">
            {run.memory.map((entry) => (
              <li key={entry.id} className={`${STEP} grid-cols-[minmax(0,1fr)_auto]`}>
                <Link href={`/memory/${entry.id}`} className="text-primary hover:underline">
                  {entry.text}
                </Link>
                <span className="small text-muted-foreground">{entry.reason}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="Handoff, written at the end of the run">
        {handoff === null ? (
          <pre className="mono m-0 whitespace-pre-wrap rounded-md bg-secondary p-3">
            <RefText text={run.handoff ?? ''} repo={run.ticket.repo} />
          </pre>
        ) : (
          <p className="text-muted-foreground">{handoff}</p>
        )}
      </Section>
    </Card>
  )
}
