import Link from 'next/link'
import { JOB_STATUS, type JobRow, type Steps } from '../lib/steps'
import { costSplit } from '../../../lib/cost'
import { Card } from './ui/card'

type Doc = Record<string, any>

const JobStates = ({ jobs }: { jobs: JobRow[] }) => (
  <ol aria-label="Jobs" data-testid="strip-jobs" className="m-0 flex list-none gap-2 p-0 font-normal text-muted-foreground">
    {jobs.map((j) => <li key={j.id} data-job={j.id} data-status={j.status}>{j.title} <span className="mono">{JOB_STATUS[j.status].toLowerCase()}</span></li>)}
  </ol>
)

export function StageStrip({ stages, steps }: { stages: { name: string; title: string }[]; steps: Steps }) {
  const last = steps.visits?.at(-1)
  const jobs = last?.stage === steps.path.current ? last.jobs : undefined
  const rounds = new Map(steps.rounds.map((r) => [r.stage, r.n]))
  const current = steps.path.current
  const at = stages.findIndex((s) => s.name === current)
  return (
    <nav aria-label="Stages" data-testid="stage-strip" className="overflow-x-auto">
      <ol className="small m-0 flex w-max list-none items-center gap-2 p-0 whitespace-nowrap">
        {stages.map((s, i) => {
          const done = steps.path.visits.has(s.name) && i < at
          const n = rounds.get(s.name)
          return (
            <li key={s.name} aria-current={s.name === current ? 'step' : undefined} className={`flex items-center gap-1 rounded-sm px-2 py-1 ${s.name === current ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground'}`}>
              {done && <span aria-hidden>✓</span>}
              {s.title}
              {n && <span className="mono" title={`${n} times`}>×{n}</span>}
              {s.name === current && jobs && <JobStates jobs={jobs} />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

const usd = (n: number) => '$' + n.toFixed(2)

export function CostPanel({ runs }: { runs: Doc[] }) {
  const { unreported, priced, estimated, total } = costSplit(runs)
  const sums = new Map<string, number>()
  for (const r of priced) sums.set(r.stage, (sums.get(r.stage) ?? 0) + Number(r.costUsd))
  const byStage = [...sums]
  return (
    <Card asChild className="gap-0 p-4">
      <section aria-label="Cost" data-testid="ticket-cost">
        <h2 className="label m-0 mb-2 text-muted-foreground">Cost</h2>
        {priced.length === 0 ? <p className="small m-0 text-muted-foreground">No priced Runs yet.</p> : (
          <>
            <p className="body m-0 mono" data-testid="cost-total">{usd(total)} total{estimated && <span className="small text-muted-foreground" data-testid="cost-estimated"> estimated</span>}</p>
            <ul className="small m-0 mt-2 flex list-none flex-wrap gap-x-4 gap-y-1 p-0" aria-label="Cost by stage">
              {byStage.map(([stage, n]) => <li key={stage}>{stage} <span className="mono">{usd(n)}</span></li>)}
            </ul>
            <ul className="small m-0 mt-2 flex list-none flex-col gap-1 border-t border-border p-0 pt-2" aria-label="Cost by Run">
              {priced.map((r) => <li key={r.id} className="flex justify-between gap-4"><Link className="text-primary" href={`/runs/${r.id}`}>Run #{r.id} · {r.stage}</Link><span className="mono">{usd(Number(r.costUsd))}</span></li>)}
            </ul>
          </>
        )}
        {unreported.length > 0 && <p className="small m-0 mt-2 text-muted-foreground" data-testid="cost-unreported">{unreported.length} session {unreported.length === 1 ? 'Run' : 'Runs'} did not report usage — run <code className="mono">npx bauherr hook install</code></p>}
      </section>
    </Card>
  )
}
