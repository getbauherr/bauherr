import Link from 'next/link'
import type { RunPage } from '../../../../core/views/run'
import Link from 'next/link'
import { Time } from '../Time'
import { Card, Section } from './Section'

const STEP = 'grid grid-cols-[112px_minmax(0,1fr)] gap-3 border-t border-border py-2 first:border-t-0'

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

function StepsEmpty({ run }: { run: RunPage }) {
  if (run.status !== 'queued') return <p className="text-muted-foreground">The agent has not reported a step yet.</p>
  if (run.sessionConnected) {
    return <p className="text-muted-foreground">The run waits for an agent. A {run.role} session is connected.</p>
  }
  return (
    <p className="text-muted-foreground">
      The run waits for an agent. No {run.role} session is connected:{' '}
      <Link href="/settings/api-key" className="text-primary hover:underline">connect one</Link>.
    </p>
  )
}

export function RunSteps({ run }: { run: RunPage }) {
  const handoff = handoffText(run)
  return (
    <Card>
      <Section title="Reported steps">
        {run.steps.length === 0 && <StepsEmpty run={run} />}
        <ol className="m-0 grid list-none p-0">
          {run.steps.map((step) => (
            <li key={`${step.at}-${step.text}`} className={STEP}>
              <Time iso={step.at} className="mono text-muted-foreground" />
              <span className="[overflow-wrap:anywhere]">{step.text}</span>
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
          <pre className={HANDOFF}>{run.handoff}</pre>
        ) : (
          <p className="[overflow-wrap:anywhere] text-muted-foreground">{handoff}</p>
        )}
      </Section>
    </Card>
  )
}
