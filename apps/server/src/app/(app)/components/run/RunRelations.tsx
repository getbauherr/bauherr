import Link from 'next/link'
import { Panel } from './Panel'

type Chain = { previous: number | null; next: number[]; escalation: number[]; investigation: number[] }

export function RunRelations({ chain, className }: { chain: Chain; className?: string }) {
  const rows: [string, number][] = [
    ...(chain.previous ? [['Continues', chain.previous] as [string, number]] : []),
    ...chain.next.map((n): [string, number] => ['Continued by', n]),
    ...chain.escalation.map((n): [string, number] => ['Escalated from', n]),
    ...chain.investigation.map((n): [string, number] => ['Investigates', n]),
  ]
  if (!rows.length) return null
  return (
    <Panel id="run-relations" title="Relations" className={className}>
      <ul aria-label="Run chain" className="small m-0 flex list-none flex-col gap-1 p-0">
        {rows.map(([word, n]) => <li key={`${word}${n}`} className="flex flex-wrap items-center gap-x-1">{word} <Link className="inline-flex min-h-6 items-center text-primary" href={`/runs/${n}`}>Run {n}</Link></li>)}
      </ul>
    </Panel>
  )
}
