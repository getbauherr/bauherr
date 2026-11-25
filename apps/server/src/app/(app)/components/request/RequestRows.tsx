import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { RequestListRow } from '../../../../core/views/request-status'
import { shortDate } from '../../lib/format'
import { Badge } from '../ui/badge'
import { Time } from '../Time'

const TYPES: Record<string, string> = { bug: 'Bug', feature: 'Feature', change: 'Change', chore: 'Chore' }
const MARK_TONE = {
  neutral: 'text-muted-foreground',
  accent: 'text-muted-foreground',
  ok: 'text-ok',
  warn: 'text-destructive',
}
const GRID = 'grid grid-cols-[28px_52px_minmax(0,1fr)_170px_100px_110px] items-center gap-3 px-4 py-2.5'

export function RequestRows({ list, staff }: { list: RequestListRow[]; staff: boolean }) {
  return (
    <div role="table" aria-label="Requests" className="border border-border bg-card">
      <div role="row" className={cn(GRID, 'label bg-secondary text-muted-foreground')}>
        <span role="columnheader" className="sr-only">
          State
        </span>
        <span role="columnheader">#</span>
        <span role="columnheader">Request</span>
        <span role="columnheader">Status</span>
        <span role="columnheader">Created</span>
        <span role="columnheader">Last change</span>
      </div>
      {list.map(({ row, status, mine }) => (
        <div key={row.recordId} role="row" className={cn(GRID, 'border-t border-border hover:bg-secondary')}>
          <span role="cell" className={cn('text-center font-semibold', MARK_TONE[status.tone])}>
            <span aria-hidden>{status.mark}</span>
          </span>
          <span role="cell" className="mono text-muted-foreground">
            #{row.number}
          </span>
          <span role="cell" className="min-w-0">
            <Link href={`${staff ? '/tickets' : '/requests'}/${row.recordId}`} className="font-medium hover:underline">
              {row.title}
            </Link>
            <br />
            <span className="small text-muted-foreground">
              {TYPES[row.type] ?? row.type} · {mine ? 'You' : row.reporter}
            </span>
          </span>
          <span role="cell">
            <Badge variant={status.tone}>{status.word}</Badge>
          </span>
          <span role="cell" className="small">
            {shortDate(row.createdAt.toISOString())}
          </span>
          <span role="cell" className="small">
            <Time iso={row.changedAt.toISOString()} />
          </span>
        </div>
      ))}
    </div>
  )
}
