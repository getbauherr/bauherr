'use client'

import { useState } from 'react'
import { usd } from '../../../lib/format'
import { protoRows, protoTotals, type Period, type ProtoRow, type ProtoVariant } from './proto-data'
import { Figure, PeriodSwitch } from './proto-parts'
import { ProtoSwitcher } from './proto-switcher'
import { ProtoTable } from './proto-table'

const grouped = (rows: ProtoRow[]) =>
  [...new Set(rows.map((row) => row.connection))].map((label) => ({
    label,
    rows: rows.filter((row) => row.connection === label),
  }))

function Headline({ rows, period }: { rows: ProtoRow[]; period: Period }) {
  const totals = protoTotals(rows, period)
  const used = Math.round((totals.cost / totals.budget) * 100)
  return (
    <section aria-label="Headline figures" className="grid gap-4 rounded-md border border-border bg-card p-4">
      <dl className="m-0 flex flex-wrap gap-x-10 gap-y-4">
        <Figure value={usd(totals.perAccepted)} label="cost per accepted ticket" hint="all models together" />
        <Figure value={`${totals.failedPct.toFixed(1)}%`} label="failed requests" hint="of all gateway requests" />
        <Figure
          value={`${usd(totals.cost)} of ${usd(totals.budget)}`}
          label="spend vs budget"
          hint={`${used}% of the ${period}-day budget`}
        />
      </dl>
      <div role="img" aria-label={`${used}% of budget used`} className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-chart-1" style={{ width: `${Math.min(used, 100)}%` }} />
      </div>
    </section>
  )
}

export function ProtoInsights({ variant }: { variant: ProtoVariant }) {
  const [period, setPeriod] = useState<Period>(30)
  const rows = protoRows(period)
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="title">Insights</h1>
        <div className="ml-auto"><PeriodSwitch value={period} onChange={setPeriod} /></div>
      </div>
      {variant === 'c' && <Headline rows={rows} period={period} />}
      <section aria-labelledby="models" className="grid gap-3 rounded-md border border-border bg-card p-4">
        <h2 id="models" className="label text-muted-foreground">Models and providers</h2>
        <ProtoTable
          groups={variant === 'c' ? grouped(rows) : [{ label: null, rows }]}
          trend={variant === 'b'}
        />
        <p className="small text-muted-foreground">
          Route: sub/* is the subscription passthrough (cost shown at list price), ws-* is a workspace key billed
          by the provider. Failed requests are counted and priced, not dropped. Click a row for its last failures.
        </p>
      </section>
      <ProtoSwitcher variant={variant} />
    </>
  )
}
