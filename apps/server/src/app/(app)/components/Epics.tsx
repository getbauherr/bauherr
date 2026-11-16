import Link from 'next/link'
import { type Epic, epicHue, epicProgress } from '../lib/epics'
import { title, type Workflow } from '../../../lib/workflow'
import { Card } from './ui/card'

export function EpicProgress({ wf, epic }: { wf: Workflow; epic: Epic }) {
  const { done, total, stages } = epicProgress(wf, epic)
  return (
    <span className="eprog flex flex-wrap items-center gap-3">
      <progress className="h-2 w-40 accent-primary" value={done} max={Math.max(total, 1)} aria-label={`${done} of ${total} ${epic.slices ? 'slices passed' : 'sub-tickets done'}`} />
      <span className="mono small">{done}/{total} {epic.slices ? 'passed' : 'done'}</span>
      <span className="small text-muted-foreground">{stages.map((s) => `${title(wf, s.stage)} ${s.count}`).join(' · ')}</span>
    </span>
  )
}

export function EpicChildren({ wf, epic }: { wf: Workflow; epic: Epic }) {
  return (
    <ul className="echildren m-0 my-3 flex list-none p-0 flex-col gap-2">
      {(epic.slices ?? epic.children.map((child) => ({ title: child.title, child, passed: false }))).map((s, i) => (
        <li key={s.child?.id ?? `pending-${i}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-2" data-pending={s.child ? undefined : ''}>
          {epic.slices && <span className="label text-muted-foreground">Slice {i + 1}</span>}
          {s.child ? (
            <>
              <span className="mono small">#{s.child.number}</span> <Link className="text-primary" href={`/tickets/${s.child.id}`}>{s.child.title}</Link>
              <span className="label text-muted-foreground">{s.passed ? 'passed' : s.child.open ? title(wf, s.child.stage) : 'done'}</span>
              <span className="small">{s.child.status}</span>
            </>
          ) : (
            <>
              <span>{s.title}</span>
              <span className="label text-muted-foreground">pending</span>
            </>
          )}
        </li>
      ))}
    </ul>
  )
}

export function EpicsView({ wf, epics }: { wf: Workflow; epics: Epic[] }) {
  return (
    <ul className="epics m-0 flex list-none p-0 flex-col gap-2">
      {epics.map((e) => (
        <li key={e.id}>
          <Card asChild className="p-3">
          <details>
            <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-2" style={{ '--tint': `oklch(60% .16 ${epicHue(e.id)})` } as React.CSSProperties}>
              <span className="size-2.5 rounded-full bg-(--tint)" />
              <span className="mono small">#{e.number}</span> <strong>{e.title}</strong>
              {e.parked && <span className="label rounded-sm border border-border px-2 text-warn" data-testid="parked-badge">Parked</span>}
              <span className="basis-full"><EpicProgress wf={wf} epic={e} /></span>
            </summary>
            <EpicChildren wf={wf} epic={e} />
            <Link className="small text-primary" href={`/tickets/${e.id}`}>Open epic</Link>
          </details>
          </Card>
        </li>
      ))}
    </ul>
  )
}
