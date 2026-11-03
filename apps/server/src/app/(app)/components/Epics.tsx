import Link from 'next/link'
import { type Epic, epicHue, epicProgress } from '../lib/epics'
import { stageLabel } from '../lib/needs-you'

export function EpicProgress({ epic }: { epic: Epic }) {
  const { done, total, stages } = epicProgress(epic)
  return (
    <span className="eprog">
      <progress value={done} max={Math.max(total, 1)} aria-label={`${done} of ${total} sub-tickets done`} />
      <span className="mono small">{done}/{total} done</span>
      <span className="small muted">{stages.map((s) => `${stageLabel(s.stage)} ${s.count}`).join(' · ')}</span>
    </span>
  )
}

export function EpicChildren({ epic }: { epic: Epic }) {
  return (
    <ul className="echildren">
      {epic.children.map((c) => (
        <li key={c.id}>
          <span className="mono small">#{c.number}</span> <Link className="link" href={`/tickets/${c.id}`}>{c.title}</Link>
          <span className="label muted">{c.open ? stageLabel(c.stage) : 'done'}</span>
          <span className="small">{c.status}</span>
        </li>
      ))}
    </ul>
  )
}

export function EpicsView({ epics }: { epics: Epic[] }) {
  return (
    <ul className="epics">
      {epics.map((e) => (
        <li key={e.id}>
          <details>
            <summary style={{ '--hue': epicHue(e.id) } as React.CSSProperties}>
              <span className="epic-dot" />
              <span className="mono small">#{e.number}</span> <strong>{e.title}</strong>
              <EpicProgress epic={e} />
            </summary>
            <EpicChildren epic={e} />
            <Link className="link small" href={`/tickets/${e.id}`}>Open epic</Link>
          </details>
        </li>
      ))}
    </ul>
  )
}
