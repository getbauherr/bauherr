import Link from 'next/link'
import { EmptyState } from '../../../components/EmptyState'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Table } from '../../../components/ui/table'
import { currentWorkspace } from '../../../lib/session'
import { isAdmin } from '../../../lib/settings'
import { tracesUp, tracesUrl } from '../../../lib/admin-proxy'
import { loadUsage, type Bar, type CostRow } from '../../../lib/usage'

export const dynamic = 'force-dynamic'

const amount = (n: number, tokens: boolean) => (tokens ? `${n.toLocaleString('en')} tokens` : `$${n.toFixed(2)}`)

function Gauge({ bar, tokens }: { bar: Bar; tokens: boolean }) {
  const pct = bar.spent == null || !bar.limit ? 0 : Math.min(100, (bar.spent / bar.limit) * 100)
  const tone = pct >= 100 ? 'bg-destructive' : pct >= 80 ? 'bg-warn' : 'bg-ok'
  return (
    <div className="flex flex-col gap-1" data-testid="budget-bar">
      <div className="small flex justify-between"><span>{bar.label}</span><span className="text-muted-foreground">{bar.spent == null ? '' : `${amount(bar.spent, tokens)} of `}{amount(bar.limit, tokens)}</span></div>
      <div role="meter" aria-label={bar.label} aria-valuemin={0} aria-valuemax={bar.limit} aria-valuenow={bar.spent ?? 0} className="h-2 rounded-sm bg-secondary"><div className={`h-full rounded-sm ${tone}`} style={{ width: `${pct}%` }} /></div>
    </div>
  )
}

function Costs({ title, rows, head }: { title: string; rows: CostRow[]; head: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="heading">{title}</h3>
      {!rows.length ? <p className="small text-muted-foreground">No Runs in the last 30 days.</p> : (
        <Table>
          <thead><tr className="label"><th>{head}</th><th className="text-right!">Cost</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.id ?? ''}${r.label}`}>
                <td>{r.id != null ? <Link href={`/tickets/${r.id}`}>#{r.number} {r.label}</Link> : r.label}</td>
                <td className="text-right">${r.costUsd.toFixed(2)}{r.estimate && <> <Badge variant="muted">estimate</Badge></>}{r.unpriced > 0 && <> <Badge variant="muted">{r.unpriced} unpriced</Badge></>}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  )
}

export default async function UsageSettings() {
  const { user, workspace } = await currentWorkspace()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const u = await loadUsage(workspace.id)
  const admin = isAdmin(user)
  const traces = admin && (await tracesUp())
  const tokens = u.unit === 'tokens'
  return (
    <>
      <h2 className="heading">AI usage</h2>
      <section aria-label="Budget" className="flex flex-col gap-3">
        <h3 className="heading">Budget, last 30 days</h3>
        {u.bars.map((b) => <Gauge key={b.label} bar={b} tokens={tokens} />)}
      </section>
      <section aria-label="Provider" className="flex flex-col gap-2">
        <h3 className="heading">Provider</h3>
        {!u.providers.length ? <p className="small text-muted-foreground">No LLM Connection yet.</p> : (
          <Table>
            <thead><tr className="label"><th>Connection</th><th>Preset</th><th>Secret</th></tr></thead>
            <tbody>{u.providers.map((p) => <tr key={p.name}><td>{p.name}</td><td>{p.preset}</td><td><Badge variant={p.secret === 'not set' ? 'destructive' : 'ok'}>{p.secret}</Badge></td></tr>)}</tbody>
          </Table>
        )}
        <Table>
          <thead><tr className="label"><th>Tier</th><th>Model</th></tr></thead>
          <tbody>{u.tiers.map((t) => <tr key={t.tier}><td>{t.tier}</td><td>{t.model || <span className="text-muted-foreground">Preset default</span>}</td></tr>)}</tbody>
        </Table>
      </section>
      <Costs title="Cost per Product" head="Product" rows={u.costs.product} />
      <Costs title="Cost per Ticket (top 20)" head="Ticket" rows={u.costs.ticket} />
      <Costs title="Cost per stage" head="Stage" rows={u.costs.stage} />
      {admin && (
        <div className="flex gap-3">
          <Button asChild variant="outline"><a href="/-/gateway/config_dump" target="_blank" rel="noreferrer">Open gateway config</a></Button>
          {traces ? <Button asChild variant="outline"><a href={tracesUrl()} target="_blank" rel="noreferrer">Open traces</a></Button> : <Button variant="outline" disabled title="Traces are off: start the stack with --profile observability and OTEL_ENABLED=1.">Open traces</Button>}
        </div>
      )}
    </>
  )
}
