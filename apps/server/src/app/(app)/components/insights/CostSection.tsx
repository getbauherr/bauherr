import Link from 'next/link'
import type { Cost, Line, Quantiles } from '../../lib/cost'
import { Table } from '../ui/table'

export const usd = (n: number | null): string => (n == null ? '—' : n >= 100 ? `$${n.toFixed(0)}` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`)
export const tok = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)))
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : '—')
const q = (x: Quantiles | null) => (x ? `${usd(x.median)} / ${usd(x.p85)}` : '—')

function Tile({ id, label, value, note }: { id: string; label: string; value: string; note?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-card p-3" data-testid={`cost-${id}`}>
      <dt className="label text-muted-foreground">{label}</dt>
      <dd className="m-0 text-[22px] leading-7 font-semibold">{value}</dd>
      {note && <dd className="small m-0 text-muted-foreground">{note}</dd>}
    </div>
  )
}

function Lines({ id, head, lines, total, extra }: { id: string; head: string; lines: Line[]; total: number; extra?: (l: Line) => React.ReactNode }) {
  if (!lines.length) return null
  return (
    <Table data-testid={id}>
      <thead><tr className="label"><th>{head}</th><th>Cost</th><th>Share</th><th>Tokens in + out</th><th>Cache</th><th>Runs</th>{extra && <th>Per Ticket (median / p85)</th>}</tr></thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.key} data-key={l.key}>
            <td>{l.label}</td>
            <td className="mono small">{usd(l.costUsd)}{l.unpriced > 0 && <span className="text-muted-foreground" title="Entries with tokens but no price"> +{l.unpriced} unpriced</span>}</td>
            <td className="mono small">{pct(l.costUsd, total)}</td>
            <td className="mono small">{tok(l.tokens)}</td>
            <td className="mono small">{tok(l.cache)}</td>
            <td className="mono small">{l.runs}</td>
            {extra && <td className="mono small">{extra(l)}</td>}
          </tr>
        ))}
      </tbody>
    </Table>
  )
}

/** Tokens and cost of the range: totals, breakdowns by model, role, session, stage and Ticket, cost per finished Ticket, and how many Runs the numbers cover. */
export function CostSection({ cost, days }: { cost: Cost; days: number }) {
  const src = Object.entries(cost.sources).map(([k, v]) => `${k} ${usd(v)}`).join(' · ')
  return (
    <section className="flex flex-col gap-3" aria-labelledby="cost" data-testid="cost-section">
      <h2 className="heading" id="cost">Cost &amp; tokens</h2>
      <p className="small m-0 text-muted-foreground">
        Last {days} days. Runner and CI Runs are priced by the gateway; session Runs report their own usage (priced at list price when the client sends tokens only); chat answers are counted as stored.{' '}
        <Link className="underline" href="/settings/usage">Budgets and cost per Product</Link>
      </p>
      <dl className="m-0 grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Cost summary">
        <Tile id="total" label="Total cost" value={usd(cost.totalUsd)} note={src || undefined} />
        <Tile id="tokens" label="Tokens in + out" value={tok(cost.tokens)} note={`${tok(cost.cache)} cache`} />
        <Tile id="per-ticket" label="Cost per finished Ticket" value={q(cost.perTicket)} note="median / 85th percentile" />
        <Tile id="done" label="Finished Tickets with cost" value={`${cost.doneTickets.priced} of ${cost.doneTickets.total}`} />
      </dl>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]" aria-label="Coverage" data-testid="cost-coverage">
        {cost.coverage.map((c) => (
          <li key={c.label} className="text-muted-foreground"><strong className="text-foreground">{pct(c.covered, c.runs)}</strong> of {c.label}: {c.covered} of {c.runs} finished Runs have usage.</li>
        ))}
        {cost.unpriced > 0 && <li className="text-muted-foreground">{cost.unpriced} usage entries have tokens but no price (model not in the catalog); their cost is not in the totals.</li>}
      </ul>
      {cost.byModel.length + cost.bySession.length === 0 ? (
        <p className="m-0 text-muted-foreground">No usage recorded in this range yet.</p>
      ) : (
        <>
          <Lines id="cost-models" head="Model" lines={cost.byModel} total={cost.totalUsd} />
          <Lines id="cost-roles" head="Role" lines={cost.byRole} total={cost.totalUsd} />
          <Lines id="cost-sessions" head="Session" lines={cost.bySession} total={cost.totalUsd} />
          <Lines id="cost-stages" head="Stage" lines={cost.byStage} total={cost.totalUsd} extra={(l) => q((l as Cost['byStage'][number]).perTicket)} />
          {cost.topTickets.length > 0 && (
            <Table data-testid="cost-tickets">
              <thead><tr className="label"><th>#</th><th>Ticket (most expensive)</th><th>Cost</th><th>Tokens in + out</th><th>Runs</th></tr></thead>
              <tbody>
                {cost.topTickets.map((t) => (
                  <tr key={t.key}>
                    <td className="mono small text-muted-foreground">#{t.number}</td>
                    <td><Link className="hover:underline" href={`/tickets/${t.id}`}>{t.label}</Link></td>
                    <td className="mono small">{usd(t.costUsd)}</td>
                    <td className="mono small">{tok(t.tokens)}</td>
                    <td className="mono small">{t.runs}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      )}
    </section>
  )
}
