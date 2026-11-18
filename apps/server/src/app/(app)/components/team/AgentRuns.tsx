'use client'
import Link from 'next/link'
import { useState } from 'react'
import { StatusChip } from '../StatusChip'
import { Button } from '../ui/button'
import { Table } from '../ui/table'
import { durationHm, usd } from '../../lib/format'
import type { SessionRun } from '../../../../lib/sessions'

const PAGE = 20
const PHONE = 'max-sm:block max-sm:[&_tbody]:block max-sm:[&_thead]:sr-only max-sm:[&_tr]:flex max-sm:[&_tr]:flex-wrap max-sm:[&_tr]:items-center max-sm:[&_tr]:gap-x-3 max-sm:[&_tr]:gap-y-1 max-sm:[&_tbody_tr]:border-t max-sm:[&_tbody_tr]:border-border max-sm:[&_tbody_tr]:px-4 max-sm:[&_tbody_tr]:py-3 max-sm:[&_td]:border-0 max-sm:[&_td]:p-0 max-sm:[&_td:first-child]:basis-full'

export function AgentRuns({ runs, titles, admin }: { runs: SessionRun[]; titles: Record<string, string>; admin: boolean }) {
  const [all, setAll] = useState(false)
  const shown = all ? runs : runs.slice(0, PAGE)
  return (
    <div className="flex flex-col gap-3">
      <Table data-testid="agent-runs" className={PHONE} role="table">
        <thead role="rowgroup">
          <tr className="label" role="row"><th role="columnheader">Ticket</th><th role="columnheader">Stage</th><th role="columnheader">Outcome</th><th role="columnheader">Duration</th>{admin && <th role="columnheader">Cost</th>}</tr>
        </thead>
        <tbody role="rowgroup">
          {shown.map((r) => (
            <tr key={r.id} data-testid="agent-run" role="row">
              <td role="cell"><Link className="text-primary" href={`/tickets/n/${r.ticket.number}`}>#{r.ticket.number} {r.ticket.title}</Link> <Link className="small text-muted-foreground" href={`/runs/${r.id}`}>Run #{r.id}</Link></td>
              <td role="cell">{titles[r.stage] ?? r.stage}</td>
              <td role="cell"><StatusChip status={r.status} />{r.outcome && <span className="small text-muted-foreground"> {r.outcome}</span>}</td>
              <td role="cell" className="mono">{r.durationSeconds == null ? '—' : durationHm(r.durationSeconds)}</td>
              {admin && <td role="cell" className="mono">{usd(r.costUsd ?? null)}</td>}
            </tr>
          ))}
        </tbody>
      </Table>
      {!all && runs.length > PAGE && <Button type="button" variant="outline" className="self-start" onClick={() => setAll(true)}>Show more ({runs.length - PAGE})</Button>}
    </div>
  )
}
