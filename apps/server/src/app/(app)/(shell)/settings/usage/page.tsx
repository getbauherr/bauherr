import Link from 'next/link'
import { Suspense } from 'react'
import { EmptyState } from '../../../components/EmptyState'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Table } from '../../../components/ui/table'
import { currentWorkspace } from '../../../lib/session'
import { isAdmin } from '../../../lib/settings'
import { tracesUp, tracesUrl } from '../../../lib/admin-proxy'
import { loadSpendUsd, loadUsage, type Bar, type CostRow } from '../../../lib/usage'
import { GatewayStatus } from '../../../components/gateway/GatewayStatus'
import { HarnessSetup } from '../../../components/gateway/HarnessSetup'
import { loadGatewaySetup } from '../../../lib/gateway-setup'
import { payloadClient } from '../../../lib/session'
import { workflowFor } from '../../../../../lib/factory'

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

const Budget = ({ bars, tokens }: { bars: Bar[]; tokens: boolean }) => bars.map((b) => <Gauge key={b.label} bar={b} tokens={tokens} />)

async function SpentBudget({ bars, slug }: { bars: Bar[]; slug: string }) {
  const spent = await loadSpendUsd(slug)
  return <Budget bars={bars.map((b, i) => (i === 0 ? { ...b, spent } : b))} tokens={false} />
}

async function Traces({ admin }: { admin: boolean }) {
  const up = admin && (await tracesUp())
  return up ? <Button asChild variant="outline"><a href={tracesUrl()} target="_blank" rel="noreferrer">Open traces</a></Button> : <Button variant="outline" disabled title="Traces are off: start the stack with --profile observability and OTEL_ENABLED=1.">Open traces</Button>
}

export default async function UsageSettings() {
  const { user, workspace } = await currentWorkspace()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const u = await loadUsage(workspace.id)
  const admin = isAdmin(user)
  const tokens = u.unit === 'tokens'
  const setup = await loadGatewaySetup(await payloadClient(), workspace, admin)
  const roles = workflowFor(workspace.id).roles.map(({ id, title }) => ({ id, title }))
  return (
    <>
      <h2 className="heading">AI usage</h2>
      <section aria-label="Budget" className="flex flex-col gap-3">
        <h3 className="heading">Budget, last 30 days</h3>
        {u.spendOf ? (
          <Suspense fallback={<><Budget bars={u.bars} tokens={false} /><div className="h-2 animate-pulse rounded-sm bg-secondary" aria-hidden /></>}>
            <SpentBudget bars={u.bars} slug={u.spendOf} />
          </Suspense>
        ) : <Budget bars={u.bars} tokens={tokens} />}
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
      <section id="measure" aria-label="Measure session cost" className="flex flex-col gap-3">
        <h3 className="heading">Measure session cost</h3>
        <p className="small m-0 text-muted-foreground">A coding session you run yourself only has a cost in Insights when its model calls go through the gateway. Pick your tool, copy the lines and start the session from that terminal. Prompts and answers are not stored, only tokens, model and cost.</p>
        <GatewayStatus status={setup.status} admin={admin} />
        <p className="small m-0">Gateway address: <span className="mono">{setup.gateway}</span></p>
        <HarnessSetup setup={setup} roles={roles} />
        <a className="small text-primary" href="https://github.com/getbauherr/bauherr/blob/main/docs/gateway.md">How the gateway measures sessions</a>
      </section>
      <Costs title="Cost per Product" head="Product" rows={u.costs.product} />
      <p className="small m-0 text-muted-foreground">Tokens and cost per model, role, session, stage and Ticket, cost per finished Ticket and how many Runs report usage: <Link className="underline" href="/insights#cost">Insights, Cost &amp; tokens</Link>.</p>
      {admin && (
        <div className="flex gap-3">
          <Button asChild variant="outline"><a href="/-/gateway/config_dump" target="_blank" rel="noreferrer">Open gateway config</a></Button>
          <Suspense fallback={<Button variant="outline" disabled>Open traces</Button>}><Traces admin={admin} /></Suspense>
        </div>
      )}
    </>
  )
}
