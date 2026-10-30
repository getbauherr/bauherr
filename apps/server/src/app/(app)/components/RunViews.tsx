import Link from 'next/link'
import { durationMs, fmtDuration, type RunDoc, type StepDoc, type ToolCallDoc } from '../lib/run'
import { StatusChip } from './StatusChip'

type Calls = Map<number, ToolCallDoc[]>

export function GraphView({ run, stages, latestByStage, release }: { run: RunDoc; stages: string[]; latestByStage: Map<string, RunDoc>; release: string | null }) {
  return (
    <ol className="rgraph">
      {stages.map((s) => {
        const r = latestByStage.get(s)
        const body = (
          <>
            <span className="label">{s}</span>
            {r ? <StatusChip status={r.status} /> : s === 'release' && release ? <span className="chip label queued">{release}</span> : <span className="muted">—</span>}
            <span className="mono small muted">{r ? fmtDuration(durationMs(r.startedAt, r.finishedAt)) : '—'}</span>
          </>
        )
        return (
          <li key={s} className="rnode" data-stage={s} aria-current={s === run.stage ? 'step' : undefined}>
            {r ? <Link href={`/runs/${r.id}`}>{body}</Link> : <div>{body}</div>}
          </li>
        )
      })}
    </ol>
  )
}

const pct = (n: number) => `${Math.min(100, Math.max(0, n)).toFixed(2)}%`

export function TimelineView({ run, steps, calls, now }: { run: RunDoc; steps: StepDoc[]; calls: Calls; now: number }) {
  if (!steps.length) return <p className="muted">No steps recorded.</p>
  const start = +new Date(run.startedAt ?? steps[0]!.at)
  const end = Math.max(+new Date(run.finishedAt ?? now), +new Date(steps.at(-1)!.at), start + 1)
  const span = end - start
  const at = (ms: number) => ((ms - start) / span) * 100
  const mark = (ms: number) => new Date(start + ms).toISOString().slice(11, 19)
  return (
    <div className="gantt">
      <div className="scale mono small muted"><span>{mark(0)}</span><span>{mark(span / 2)}</span><span>{mark(span)}</span></div>
      {steps.map((s, i) => {
        const from = +new Date(s.at)
        const to = steps[i + 1] ? +new Date(steps[i + 1]!.at) : end
        let offset = from
        return (
          <div key={s.id} className="gstep">
            <div className="track"><span className="bar" style={{ left: pct(at(from)), width: pct(Math.max(at(to) - at(from), 0.5)) }} /></div>
            <div className="rowlabel"><span className="mono muted">{s.seq}</span><span className="trunc">{s.summary ?? 'Step'}</span><span className="mono small muted">{fmtDuration(to - from)}</span></div>
            {(calls.get(s.id) ?? []).map((c) => {
              const w = c.durationMs ?? 0
              const left = offset
              offset += w
              return (
                <div key={c.id} className="track sub" title={`${c.name} ${fmtDuration(c.durationMs)}`}>
                  <span className={`bar thin ${c.status === 'error' ? 'bad' : ''}`} style={{ left: pct(at(left)), width: pct(Math.max((w / span) * 100, 0.5)) }} />
                  <span className="mono small muted tname" style={{ left: pct(at(left)) }}>{c.name}</span>
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
  if (!steps.length) return <p className="muted">No steps recorded.</p>
  const end = run.finishedAt ?? null
  return (
    <div className="scroll">
      {total > steps.length && <p className="muted small">Showing the first {steps.length} of {total} steps.</p>}
      <table className="table">
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
                    <ul>
                      {cs.map((c) => (
                        <li key={c.id}><span className="mono">{c.name}</span> <span className="mono small muted">{c.inputDigest ?? ''}</span> <span className={`label ${c.status === 'error' ? 'failed' : 'ok'}`}>{c.status ?? '—'}</span></li>
                      ))}
                    </ul>
                  </details>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
