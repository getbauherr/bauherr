import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { RunHealthState } from '../../../../lib/run-health'
import { durationMs, fmtDuration, type RunDoc, type StepDoc, type ToolCallDoc } from '../../lib/run'
import { timelineEmpty } from '../../lib/run-view'
import { TimelineView } from '../RunViews'
import { Time } from '../Time'
import { Panel } from './Panel'

export function RunTimeline({ run, steps, total, calls, state, now, admin, bars, className }: { run: RunDoc; steps: StepDoc[]; total: number; calls: Map<number, ToolCallDoc[]>; state: RunHealthState; now: number; admin: boolean; bars: boolean; className?: string }) {
  return (
    <Panel id="run-timeline" title="Timeline" className={className}>
      {admin && steps.length > 0 && <Link className="small inline-flex min-h-6 items-center self-start text-primary" href={bars ? '?' : '?bars=1'}>{bars ? 'Show list' : 'Show bars'}</Link>}
      {!steps.length ? <p className="m-0 text-muted-foreground">{timelineEmpty(state, run.startedAt, now)}</p> : bars && admin ? <TimelineView run={run} steps={steps} calls={calls} now={now} /> : (
        <>
          {total > steps.length && <p className="small m-0 text-muted-foreground">Showing the first {steps.length} of {total} steps.</p>}
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {steps.map((s, i) => {
              const cs = calls.get(s.id) ?? []
              return (
                <li key={s.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <Time iso={s.at} now={now} className="mono small whitespace-nowrap text-muted-foreground" />
                  <span className="min-w-0 flex-[1_1_20ch] break-words">{s.summary ?? 'Step'}</span>
                  {admin && <span className="mono small text-muted-foreground">{s.tokensIn ?? 0} / {s.tokensOut ?? 0} · {fmtDuration(durationMs(s.at, steps[i + 1]?.at ?? run.finishedAt))}</span>}
                  {admin && cs.length > 0 && (
                    <details className="calls basis-full">
                      <summary className="mono small cursor-pointer">{cs.length} tool {cs.length === 1 ? 'call' : 'calls'}</summary>
                      <ul className="m-0 mt-2 pl-4">
                        {cs.map((c) => <li key={c.id}><span className="mono">{c.name}</span> <span className="mono small break-all text-muted-foreground">{c.inputDigest ?? ''}</span> <span className={cn('label', c.status === 'error' ? 'text-destructive' : 'text-ok')}>{c.status ?? '—'}</span></li>)}
                      </ul>
                    </details>
                  )}
                </li>
              )
            })}
          </ol>
        </>
      )}
    </Panel>
  )
}
