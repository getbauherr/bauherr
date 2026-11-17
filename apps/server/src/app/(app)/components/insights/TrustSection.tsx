import { cn } from '@/lib/utils'
import { GRADES } from '../../../../lib/trust'
import { usd } from '../../lib/format'
import type { ProductTrust } from '../../lib/insights'
import { GRADE_TONE } from '../TrustCard'
import { Table } from '../ui/table'

const pct = (x: number | null) => (x == null ? '—' : `${Math.round(x * 100)} %`)
const one = (x: number | null) => (x == null ? '—' : x.toFixed(1))

function Tile({ id, label, value, note }: { id: string; label: string; value: string; note?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-card p-3" data-testid={`trust-${id}`}>
      <dt className="label text-muted-foreground">{label}</dt>
      <dd className="m-0 text-[22px] leading-7 font-semibold">{value}</dd>
      {note && <dd className="small m-0 text-muted-foreground">{note}</dd>}
    </div>
  )
}

export function TrustSection({ trust, days }: { trust: ProductTrust[]; days: number }) {
  return (
    <section className="flex flex-col gap-4" aria-labelledby="trust" data-testid="trust-section">
      <h2 className="heading" id="trust">Trust</h2>
      <p className="small m-0 text-muted-foreground">Tickets that reached done in the last {days} days, graded on checks, proof, review and human interventions. Escaped defects are bugs created in the range whose cause Triage named as a Ticket done within 30 days before.</p>
      {trust.map((p) => (
        <div key={p.product.id} className="flex flex-col gap-3" data-testid="trust-product" data-product={p.product.id}>
          <h3 className="m-0 font-semibold">{p.product.name}</h3>
          <p className={cn('small m-0', p.earned.met ? 'text-ok' : 'text-muted-foreground')} data-testid="trust-earned">{p.earned.text}</p>
          <dl className="m-0 grid grid-cols-2 gap-3 md:grid-cols-5" aria-label={`Trust of ${p.product.name}`}>
            <Tile id="done" label="Done" value={String(p.done)} />
            <Tile id="interventions" label="Interventions per Ticket" value={one(p.interventionsPerTicket)} />
            <Tile id="rework" label="Rework rate" value={pct(p.reworkRate)} note={`${one(p.sendBacksPerTicket)} send-backs per Ticket`} />
            <Tile id="cost" label="Cost per accepted change" value={usd(p.costPerChange)} />
            <Tile id="escaped" label="Escaped defects" value={String(p.escaped)} />
            <Tile id="reverts" label="Revert rate" value={p.reverts ? pct(p.reverts.merged ? p.reverts.reverts / p.reverts.merged : null) : '—'} note={p.reverts ? `${p.reverts.reverts} of the last ${p.reverts.merged} merged PRs` : 'The forge did not answer'} />
          </dl>
          <p className="small m-0 flex flex-wrap gap-x-4 gap-y-1" aria-label="Grades" data-testid="trust-grades">
            {GRADES.map((g) => <span key={g}><strong className={GRADE_TONE[g]}>{g}</strong> <span className="mono">{p.grades[g]}</span></span>)}
          </p>
          {p.sendBacks.length > 0 && (
            <Table data-testid="trust-sendbacks">
              <thead><tr className="label"><th>Send-backs from</th><th>Reason</th><th>Count</th></tr></thead>
              <tbody>
                {p.sendBacks.map((s) => <tr key={`${s.stage}|${s.by}`}><td className="capitalize">{s.stage}</td><td className="small text-muted-foreground">{s.by === 'review' ? 'Review findings' : 'Sent back by a person'}</td><td className="mono small">{s.count}</td></tr>)}
              </tbody>
            </Table>
          )}
        </div>
      ))}
    </section>
  )
}
