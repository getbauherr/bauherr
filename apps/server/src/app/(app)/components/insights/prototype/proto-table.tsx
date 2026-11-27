'use client'

import { Fragment, useState } from 'react'
import { cn } from '@/lib/utils'
import { ago, usd } from '../../../lib/format'
import { Button } from '../../ui/button'
import { Table } from '../../ui/table'
import { NOW, type ProtoRow } from './proto-data'
import { ShareBar, Sparkline } from './proto-parts'

type SortKey = 'model' | 'connection' | 'route' | 'runs' | 'requests' | 'failedPct' | 'cost' | 'perAccepted'
type Group = { label: string | null; rows: ProtoRow[] }
type Props = { groups: Group[]; trend?: boolean }

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'model', label: 'Model', numeric: false },
  { key: 'connection', label: 'Connection', numeric: false },
  { key: 'route', label: 'Route', numeric: false },
  { key: 'runs', label: 'Runs', numeric: true },
  { key: 'requests', label: 'Requests', numeric: true },
  { key: 'failedPct', label: 'Failed %', numeric: true },
  { key: 'cost', label: 'Cost', numeric: true },
  { key: 'perAccepted', label: 'Cost per accepted ticket', numeric: true },
]

const sorted = (rows: ProtoRow[], key: SortKey, dir: 1 | -1): ProtoRow[] =>
  [...rows].sort((a, b) => {
    const [x, y] = [a[key], b[key]]
    if (x === y) return 0
    if (x === null) return 1
    if (y === null) return -1
    return (x < y ? -1 : 1) * dir
  })

const stamp = (daysAgo: number, hour: number): string =>
  ago(new Date(Date.parse(NOW) - daysAgo * 864e5 + (hour - 12) * 36e5).toISOString(), Date.parse(NOW))

function Failures({ row }: { row: ProtoRow }) {
  if (row.failures.length === 0) return <p className="small text-muted-foreground">No failed request in this range.</p>
  return (
    <div className="grid gap-2">
      <p className="label text-muted-foreground">Last failed requests</p>
      <ul className="m-0 grid list-none gap-1 p-0">
        {row.failures.slice(0, 5).map((entry, index) => (
          <li key={index} className="flex flex-wrap items-baseline gap-x-3">
            <span className="mono w-10 text-danger">{entry.status}</span>
            <span className="min-w-0 flex-1">{entry.message}</span>
            <span className="small text-muted-foreground">{stamp(entry.daysAgo, entry.hour)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function RowCells({ row, trend }: { row: ProtoRow; trend: boolean }) {
  return (
    <>
      <td className="whitespace-nowrap">{row.model}</td>
      <td>{row.connection}</td>
      <td className="mono">{row.route}</td>
      <td className="mono text-right">{row.runs}</td>
      <td className="mono text-right">{row.requests}</td>
      <td className={cn('mono text-right', row.failedPct > 5 && 'font-medium text-danger')}>
        {row.failedPct.toFixed(1)}%
      </td>
      <td className="mono text-right">{usd(row.cost)}</td>
      <td className="mono text-right">{usd(row.perAccepted)}</td>
      {trend && (
        <>
          <td className="pl-4"><Sparkline series={row.series} label={`Daily cost of ${row.model}`} /></td>
          <td><ShareBar share={row.share} /></td>
        </>
      )}
    </>
  )
}

type Sort = { key: SortKey; dir: 1 | -1 }

function Head({ sort, trend, onSort }: { sort: Sort; trend: boolean; onSort: (key: SortKey) => void }) {
  return (
    <thead>
      <tr>
        {COLUMNS.map((column) => (
          <th
            key={column.key}
            scope="col"
            aria-sort={sort.key === column.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
            className={cn(column.numeric && 'text-right!')}
          >
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="h-auto px-1 py-1 text-sm"
              onClick={() => onSort(column.key)}
            >
              {column.label}
              {sort.key === column.key && <span aria-hidden>{sort.dir === 1 ? '↑' : '↓'}</span>}
            </Button>
          </th>
        ))}
        {trend && <th scope="col" className="pl-4">Daily cost</th>}
        {trend && <th scope="col">Share of cost</th>}
      </tr>
    </thead>
  )
}

export function ProtoTable({ groups, trend = false }: Props) {
  const [sort, setSort] = useState<Sort>({ key: 'cost', dir: -1 })
  const [open, setOpen] = useState<string | null>(null)
  const span = COLUMNS.length + (trend ? 2 : 0)
  const toggle = (key: SortKey) => setSort((now) => ({ key, dir: now.key === key ? (-now.dir as 1 | -1) : -1 }))
  return (
    <Table aria-label="Cost and reliability by model">
      <Head sort={sort} trend={trend} onSort={toggle} />
      <tbody>
        {groups.map((group) => (
          <Fragment key={group.label ?? 'all'}>
            {group.label && (
              <tr>
                <th scope="colgroup" colSpan={span} className="label bg-muted text-muted-foreground">
                  {group.label}
                </th>
              </tr>
            )}
            {sorted(group.rows, sort.key, sort.dir).map((row) => (
              <Fragment key={row.id}>
                <tr
                  aria-expanded={open === row.id}
                  tabIndex={0}
                  onClick={() => setOpen(open === row.id ? null : row.id)}
                  onKeyDown={(event) => event.key === 'Enter' && setOpen(open === row.id ? null : row.id)}
                  className="cursor-pointer hover:bg-muted/50"
                >
                  <RowCells row={row} trend={trend} />
                </tr>
                {open === row.id && (
                  <tr>
                    <td colSpan={span} className="bg-muted/40 p-4"><Failures row={row} /></td>
                  </tr>
                )}
              </Fragment>
            ))}
          </Fragment>
        ))}
      </tbody>
    </Table>
  )
}
