import Link from 'next/link'
import { notFound } from 'next/navigation'
import { EmptyState } from '../../../components/EmptyState'
import { Field } from '../../../components/SettingsForm'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Table } from '../../../components/ui/table'
import { Tab, Tabs } from '../../../components/ui/tabs'
import { isAdmin, loadAudit } from '../../../lib/settings'
import { currentWorkspace } from '../../../lib/session'

export const dynamic = 'force-dynamic'

/** GET-form filter input with its own error line (the shared `Field` takes errors from a server-action form). */
function FilterField({ name, label, hint, defaultValue, error }: { name: string; label: string; hint?: string; defaultValue: string; error?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={name} className="small text-muted-foreground">{label}</label>
      <Input id={name} name={name} defaultValue={defaultValue} aria-invalid={!!error || undefined} aria-describedby={error ? `${name}-e` : undefined} className="aria-[invalid]:border-destructive" />
      {hint && <span className="small text-muted-foreground">{hint}</span>}
      {error && <span id={`${name}-e`} role="alert" className="small text-destructive">{error}</span>}
    </div>
  )
}

export default async function Audit({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user, workspace } = await currentWorkspace()
  if (!isAdmin(user)) notFound()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const sp = await searchParams
  const tab = sp.tab === 'calls' ? 'calls' : 'touches'
  const { rows, errors } = await loadAudit(workspace.id, tab, sp)
  return (
    <>
      <h2 className="heading">Audit</h2>
      <Tabs aria-label="Audit">
        <Tab href="/settings/audit" aria-current={tab === 'touches' ? 'page' : undefined}>Touches</Tab>
        <Tab href="/settings/audit?tab=calls" aria-current={tab === 'calls' ? 'page' : undefined}>Tool calls</Tab>
      </Tabs>
      <form className="flex flex-col gap-4" method="get">
        <input type="hidden" name="tab" value={tab} />
        <div className="grid grid-cols-3 gap-4 max-sm:grid-cols-1">
          <FilterField name="ticket" label="Ticket" hint="#12 or repo#12" defaultValue={sp.ticket ?? ''} error={errors.ticket} />
          <FilterField name="run" label="Run id" defaultValue={sp.run ?? ''} error={errors.run} />
          {tab === 'touches' && <Field name="actor" label="Actor" defaultValue={sp.actor ?? ''} />}
        </div>
        <div><Button variant="outline">Filter</Button></div>
      </form>
      {Object.keys(errors).length ? null : !rows.length ? (
        <EmptyState text="No entries match." />
      ) : (
        <Table>
            <thead><tr className="label"><th>When</th><th>{tab === 'touches' ? 'Kind' : 'Tool'}</th>{tab === 'touches' ? <th>Actor</th> : <><th>Status</th><th>Input</th></>}<th>Ticket</th><th>Run</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.at ? new Date(r.at).toISOString().slice(0, 19).replace('T', ' ') : '—'}</td>
                  <td>{r.kind}</td>
                  {tab === 'touches' ? <td>{r.actor === 'factory' ? <span className="text-muted-foreground">Factory</span> : r.actor}</td> : <><td><span className={r.status === 'error' ? 'text-destructive' : 'text-ok'}>{r.status === 'error' ? 'Error' : 'OK'}</span>{r.durationMs != null && <span className="text-muted-foreground"> {r.durationMs} ms</span>}</td><td className="mono small">{r.digest}</td></>}
                  <td>{r.ticket ? <Link className="text-primary" href={`/tickets/${r.ticket.id}`}>{r.ticket.label}</Link> : '—'}</td>
                  <td>{r.runId ? <Link className="text-primary" href={`/runs/${r.runId}`}>#{r.runId}</Link> : '—'}</td>
                </tr>
              ))}
            </tbody>
        </Table>
      )}
    </>
  )
}
