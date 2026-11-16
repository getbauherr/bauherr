'use client'
import Link from 'next/link'
import { useState } from 'react'
import { StatusChip } from '../StatusChip'
import { Button } from '../ui/button'
import { Table } from '../ui/table'
import { durationHm, usd } from '../../lib/format'
import type { SessionRun } from '../../../../lib/sessions'

const PAGE = 20

/** Runs of the agent, newest first: 20, then "Show more". Cost only when the page sent it (Admin). */
export function AgentRuns({ runs, titles, admin }: { runs: SessionRun[]; titles: Record<string, string>; admin: boolean }) {
  const [all, setAll] = useState(false)
  const shown = all ? runs : runs.slice(0, PAGE)
  return (
    <div className="flex flex-col gap-3">
      <Table data-testid="agent-runs">
        <thead>
          <tr className="label"><th>Ticket</th><th>Stage</th><th>Outcome</th><th>Duration</th>{admin && <th>Cost</th>}</tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.id} data-testid="agent-run">
              <td><Link className="text-primary" href={`/tickets/n/${r.ticket.number}`}>#{r.ticket.number} {r.ticket.title}</Link> <Link className="small text-muted-foreground" href={`/runs/${r.id}`}>Run #{r.id}</Link></td>
              <td>{titles[r.stage] ?? r.stage}</td>
              <td><StatusChip status={r.status} />{r.outcome && <span className="small text-muted-foreground"> {r.outcome}</span>}</td>
              <td className="mono">{r.durationSeconds == null ? '—' : durationHm(r.durationSeconds)}</td>
              {admin && <td className="mono">{usd(r.costUsd ?? null)}</td>}
            </tr>
          ))}
        </tbody>
      </Table>
      {!all && runs.length > PAGE && <Button type="button" variant="outline" className="self-start" onClick={() => setAll(true)}>Show more ({runs.length - PAGE})</Button>}
    </div>
  )
}
