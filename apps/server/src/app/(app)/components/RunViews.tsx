import { Table } from './ui/table'
import { cn } from '@/lib/utils'
import { durationMs, fmtDuration, type RunDoc, type StepDoc, type ToolCallDoc } from '../lib/run'

type Calls = Map<number, ToolCallDoc[]>

const pct = (n: number) => `${Math.min(100, Math.max(0, n)).toFixed(2)}%`

export function TimelineView({ run, steps, calls, now }: { run: RunDoc; steps: StepDoc[]; calls: Calls; now: number }) {
  if (!steps.length) return <p className="text-muted-foreground">No steps recorded.</p>
  const start = +new Date(run.startedAt ?? steps[0]!.at)
  const end = Math.max(+new Date(run.finishedAt ?? now), +new Date(steps.at(-1)!.at), start + 1)
  const span = end - start
  const at = (ms: number) => ((ms - start) / span) * 100
  const mark = (ms: number) => new Date(start + ms).toISOString().slice(11, 19)
  return (
    <div className="flex flex-col gap-3">
      <div className="mono small flex justify-between border-b border-border text-muted-foreground"><span>{mark(0)}</span><span>{mark(span / 2)}</span><span>{mark(span)}</span></div>
      {steps.map((s, i) => {
        const from = +new Date(s.at)
        const to = steps[i + 1] ? +new Date(steps[i + 1]!.at) : end
        let offset = from
        return (
          <div key={s.id} className="gstep flex flex-col gap-1">
            <div className="track relative h-3 rounded-sm bg-secondary"><span className="bar absolute inset-y-0 rounded-sm bg-primary" style={{ left: pct(at(from)), width: pct(Math.max(at(to) - at(from), 0.5)) }} /></div>
            <div className="flex items-baseline gap-3"><span className="mono text-muted-foreground">{s.seq}</span><span className="min-w-0 flex-1 truncate">{s.summary ?? 'Step'}</span><span className="mono small text-muted-foreground">{fmtDuration(to - from)}</span></div>
            {(calls.get(s.id) ?? []).map((c) => {
              const w = c.durationMs ?? 0
              const left = offset
              offset += w
              return (
                <div key={c.id} className="track sub relative mb-3 h-2" title={`${c.name} ${fmtDuration(c.durationMs)}`}>
                  <span className={cn('bar absolute inset-y-0 rounded-sm', c.status === 'error' ? 'bg-destructive' : 'bg-muted-foreground')} style={{ left: pct(at(left)), width: pct(Math.max((w / span) * 100, 0.5)) }} />
                  <span className="mono small absolute top-2 whitespace-nowrap text-muted-foreground" style={{ left: pct(at(left)) }}>{c.name}</span>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

export function ListView({ run, steps, total, calls }: { run: RunDoc; steps: StepDoc[]; total: number; calls: Calls }) {
  if (!steps.length) return <p className="text-muted-foreground">No steps recorded.</p>
  const end = run.finishedAt ?? null
  return (
    <>
      {total > steps.length && <p className="small text-muted-foreground">Showing the first {steps.length} of {total} steps.</p>}
      <Table>
        <thead><tr className="label">{['#', 'Step', 'Tokens in/out', 'Started', 'Duration', 'Tool calls'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>
          {steps.map((s, i) => {
            const cs = calls.get(s.id) ?? []
            return (
              <tr key={s.id}>
                <td className="mono">{s.seq}</td>
                <td>{s.summary ?? 'Step'}</td>
                <td className="mono">{s.tokensIn ?? 0} / {s.tokensOut ?? 0}</td>
                <td className="mono">{s.at.slice(11, 19)}</td>
                <td className="mono">{fmtDuration(durationMs(s.at, steps[i + 1]?.at ?? end))}</td>
                <td>
                  <details className="calls">
                    <summary className="mono">{cs.length}</summary>
                    <ul className="m-0 mt-2 pl-4">
                      {cs.map((c) => (
                        <li key={c.id}><span className="mono">{c.name}</span> <span className="mono small text-muted-foreground">{c.inputDigest ?? ''}</span> <span className={cn('label', c.status === 'error' ? 'text-destructive' : 'text-ok')}>{c.status ?? '—'}</span></li>
                      ))}
                    </ul>
                  </details>
                </td>
              </tr>
            )
          })}
        </tbody>
      </Table>
    </>
  )
}
