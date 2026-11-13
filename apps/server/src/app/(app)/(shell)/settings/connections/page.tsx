import { notFound } from 'next/navigation'
import { EditDrawer } from '../../../components/EditDrawer'
import { EmptyState } from '../../../components/EmptyState'
import { ConnectionForm } from '../../../components/SettingsConnectionForm'
import { Field, SettingsForm } from '../../../components/SettingsForm'
import { Checkbox } from '../../../components/ui/checkbox'
import { Badge } from '../../../components/ui/badge'
import { Card } from '../../../components/ui/card'
import { Table } from '../../../components/ui/table'
import { connectionPresets as presets, isAdmin, loadConnections } from '../../../lib/settings'
import { currentWorkspace, payloadClient } from '../../../lib/session'
import { loadMonitoring, OFFERED, TITLES, type MonitoringView, type Service } from '../../../../../lib/monitoring'
import { removeMonitoring, saveMonitoring, testMonitoringAction, verifyConnection } from '../actions'

export const dynamic = 'force-dynamic'

const chip = { ok: ['ok', 'Verified'], failed: ['destructive', 'Failed'], none: ['neutral', 'Not verified'] } as const

const HELP: Record<string, string> = {
  otlp: 'Where the gateway sends its request traces (OTLP). Changes apply without a restart. Removing it restores the bundled setup.',
  grafana: 'Adds an "Open dashboards" link to AI usage and Health.',
}

function Monitoring({ service, value }: { service: Service; value?: MonitoringView }) {
  const c = value?.config ?? {}
  const title = TITLES[service]
  return (
    <Card asChild className="gap-4"><section aria-label={title}>
      <h3 className="heading">{title}</h3>
      <p className="small m-0 text-muted-foreground">{HELP[service]}</p>
      {value && (
        <p className="small m-0 flex flex-wrap items-center gap-2">
          <Badge variant={chip[value.status][0]}>{chip[value.status][1]}</Badge>
          {value.detail && <span className="text-muted-foreground">{value.status === 'ok' ? value.detail.slice(0, 16).replace('T', ' ') : value.detail}</span>}
          {value.hasSecret && <span className="text-muted-foreground">{service === 'otlp' ? 'Header value' : 'Token'} saved, never shown again</span>}
        </p>
      )}
      <SettingsForm action={saveMonitoring} submit={value ? 'Save' : 'Connect'} primary={!value}>
        {value && <input type="hidden" name="id" value={value.id} />}
        <input type="hidden" name="service" value={service} />
        {service === 'otlp' ? (
          <>
            <Field name="host" label="Endpoint" example="collector.example.com:4317" hint="host:port of an OTLP receiver. No TLS: put a collector in front for anything beyond your own network." defaultValue={c.host} required />
            <Field name="protocol" label="Protocol" options={['grpc', 'http']} defaultValue={c.protocol ?? 'grpc'} hint="grpc is usually port 4317, http port 4318." />
            <Field name="headerName" label="Auth header name (optional)" example="authorization" defaultValue={c.headerName} />
            <Field name="secret" label="Auth header value" type="password" autoComplete="off" placeholder={value?.hasSecret ? 'unchanged' : ''} hint="Written into the gateway's config.yaml (0600), not into the browser. Not offered by every collector." />
            <Field name="uiUrl" label="Traces UI address (optional)" type="url" example="https://jaeger.example.com" hint={'Where "Open traces" goes.'} defaultValue={c.uiUrl} />
          </>
        ) : (
          <>
            <Field name="url" label="Grafana address" type="url" example="https://grafana.example.com" defaultValue={c.url} required />
            <Field name="secret" label="Service-account token (optional)" type="password" autoComplete="off" placeholder={value?.hasSecret ? 'unchanged' : ''} hint="Only used to check that Grafana accepts it." />
          </>
        )}
        {value?.hasSecret && <label className="small flex items-center gap-2"><Checkbox name="clearSecret" />Remove the saved {service === 'otlp' ? 'header value' : 'token'}</label>}
      </SettingsForm>
      {value && (
        <div className="flex flex-wrap items-center gap-3">
          <SettingsForm action={testMonitoringAction} submit="Test connection" inline><input type="hidden" name="id" value={value.id} /></SettingsForm>
          <SettingsForm action={removeMonitoring} submit="Remove" confirm={`Yes, remove ${title}`} inline><input type="hidden" name="id" value={value.id} /></SettingsForm>
        </div>
      )}
    </section></Card>
  )
}

export default async function ConnectionSettings() {
  const { user, workspace } = await currentWorkspace()
  if (!isAdmin(user)) notFound()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const [connections, monitoring] = await Promise.all([loadConnections(workspace.id), payloadClient().then(loadMonitoring)])
  return (
    <>
      <h2 className="heading">Connections</h2>
      {!connections.length && <EmptyState text={`${workspace.name} has no Connections yet.`} />}
      {connections.length > 0 && (
        <Table>
            <thead><tr className="label"><th>Name</th><th>Kind</th><th>Preset</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {connections.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.kind}</td>
                  <td>{c.provider || <span className="text-muted-foreground">n/a</span>}</td>
                  <td>
                    <Badge variant={chip[c.status === 'none' && c.inUse ? 'ok' : c.status][0]}>{c.status === 'none' && c.inUse ? 'In use' : chip[c.status][1]}</Badge>{' '}
                    {c.detail && <span className="small text-muted-foreground">{c.status === 'ok' ? c.detail.slice(0, 16).replace('T', ' ') : c.detail}</span>}
                  </td>
                  <td>
                    <div className="flex flex-wrap items-center justify-start gap-3">
                      <EditDrawer><ConnectionForm presets={presets} value={{ id: c.id, name: c.name, kind: c.kind, provider: c.provider, config: c.config }} /></EditDrawer>
                      <SettingsForm action={verifyConnection} submit="Verify again" inline><input type="hidden" name="id" value={c.id} /></SettingsForm>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
        </Table>
      )}
      <Card asChild className="gap-4"><section>
        <h2 className="heading">Add Connection</h2>
        <ConnectionForm presets={presets} submit="Add Connection" reset primary />
      </section></Card>
      <section aria-label="Monitoring" className="flex flex-col gap-4">
        <h2 className="heading">Monitoring</h2>
        <p className="small m-0 text-muted-foreground">For the whole instance, not one Workspace: one entry per service, Admins only. Credentials are stored encrypted and never shown again.</p>
        {OFFERED.map((service) => <Monitoring key={service} service={service} value={monitoring[service]} />)}
      </section>
    </>
  )
}
