import Link from 'next/link'
import { type Epic, epicHue, epicProgress } from '../lib/epics'
import { stageLabel } from '../lib/needs-you'
import { Card } from './ui/card'

export function EpicProgress({ epic }: { epic: Epic }) {
  const { done, total, stages } = epicProgress(epic)
  return (
    <span className="eprog flex flex-wrap items-center gap-3">
      <progress className="h-2 w-40 accent-primary" value={done} max={Math.max(total, 1)} aria-label={`${done} of ${total} sub-tickets done`} />
      <span className="mono small">{done}/{total} done</span>
      <span className="small text-muted-foreground">{stages.map((s) => `${stageLabel(s.stage)} ${s.count}`).join(' · ')}</span>
    </span>
  )
}

export function EpicChildren({ epic }: { epic: Epic }) {
  return (
    <ul className="echildren m-0 my-3 flex list-none p-0 flex-col gap-2">
      {epic.children.map((c) => (
        <li key={c.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
          <span className="mono small">#{c.number}</span> <Link className="text-primary" href={`/tickets/${c.id}`}>{c.title}</Link>
          <span className="label text-muted-foreground">{c.open ? stageLabel(c.stage) : 'done'}</span>
          <span className="small">{c.status}</span>
        </li>
      ))}
    </ul>
  )
}

export function EpicsView({ epics }: { epics: Epic[] }) {
  return (
    <ul className="epics m-0 flex list-none p-0 flex-col gap-2">
      {epics.map((e) => (
        <li key={e.id}>
          <Card asChild className="p-3">
          <details>
            <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-2" style={{ '--tint': `oklch(60% .16 ${epicHue(e.id)})` } as React.CSSProperties}>
              <span className="size-2.5 rounded-full bg-(--tint)" />
              <span className="mono small">#{e.number}</span> <strong>{e.title}</strong>
              <span className="basis-full"><EpicProgress epic={e} /></span>
            </summary>
            <EpicChildren epic={e} />
            <Link className="small text-primary" href={`/tickets/${e.id}`}>Open epic</Link>
          </details>
          </Card>
        </li>
      ))}
    </ul>
  )
}
