import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { RequestListRow } from '../../../../core/views/request-status'
import { shortDate } from '../../lib/format'
import { Badge } from '../ui/badge'
import { Time } from '../Time'
import { RequestsMore, type MoreRequests } from './RequestsMore'

const TYPES: Record<string, string> = { bug: 'Bug', feature: 'Feature', change: 'Change', chore: 'Chore' }
const MARK_TONE = {
  neutral: 'text-muted-foreground',
  accent: 'text-primary',
  ok: 'text-ok',
  warn: 'text-destructive',
}
const GRID = cn(
  'grid grid-cols-[28px_52px_minmax(0,1fr)_170px_100px_110px] items-center gap-3 px-4 py-2.5',
  'max-md:grid-cols-[48px_minmax(0,1fr)_110px]',
)
const WIDE = 'max-md:hidden'

export function RequestRow({ item, staff }: { item: RequestListRow; staff: boolean }) {
  const { row, status, mine } = item
  return (
    <div role="row" className={cn(GRID, 'border-t border-border hover:bg-secondary')}>
      <span role="cell" className={cn('flex justify-center', MARK_TONE[status.tone], WIDE)}>
        <span aria-hidden className="size-2 rounded-full bg-current" />
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
      <span role="cell" className={WIDE}>
        <Badge variant={status.tone}>{status.word}</Badge>
      </span>
      <span role="cell" className={cn('small', WIDE)}>
        {shortDate(row.createdAt.toISOString())}
      </span>
      <span role="cell" className="small">
        <Time iso={row.changedAt.toISOString()} />
      </span>
    </div>
  )
}

type Props = { list: RequestListRow[]; staff: boolean; more?: MoreRequests | undefined }

export function RequestRows({ list, staff, more }: Props) {
  return (
    <div role="table" aria-label="Requests" className="border border-border bg-card">
      <div role="row" className={cn(GRID, 'label bg-secondary text-muted-foreground')}>
        <span role="columnheader" className={WIDE}>
          <span className="sr-only">State</span>
        </span>
        <span role="columnheader">#</span>
        <span role="columnheader">Request</span>
        <span role="columnheader" className={WIDE}>
          Status
        </span>
        <span role="columnheader" className={WIDE}>
          Created
        </span>
        <span role="columnheader">Last change</span>
      </div>
      {list.map((item) => (
        <RequestRow key={item.row.recordId} item={item} staff={staff} />
      ))}
      {more && <RequestsMore {...more} />}
    </div>
  )
}
