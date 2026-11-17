import { durationMs, fmtDuration } from '../../lib/run'
import { runTimes } from '../../lib/run-view'
import { Time } from '../Time'
import { Panel } from './Panel'

export function RunTimes({ run, lastReportAt, now, className }: { run: { createdAt: string; startedAt: string | null; finishedAt: string | null }; lastReportAt: string | null; now: number; className?: string }) {
  const took = run.startedAt && run.finishedAt ? fmtDuration(durationMs(run.startedAt, run.finishedAt)) : null
  return (
    <Panel id="run-times" title="Times" className={className}>
      <dl className="small m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 [&_dd]:m-0">
        {runTimes(run, lastReportAt).map((t) => <div key={t.label} className="contents"><dt className="text-muted-foreground">{t.label}</dt><dd><Time iso={t.iso} now={now} /></dd></div>)}
        {took && <div className="contents"><dt className="text-muted-foreground">Took</dt><dd className="mono">{took}</dd></div>}
      </dl>
    </Panel>
  )
}
