import { EmptyState } from '../../../components/EmptyState'
import { ConnectionForm } from '../../../components/SettingsConnectionForm'
import { SettingsForm } from '../../../components/SettingsForm'
import { PRESETS } from '../../../../../lib/providers'
import { isAdmin, loadConnections } from '../../../lib/settings'
import { currentWorkspace } from '../../../lib/session'
import { verifyConnection } from '../actions'

export const dynamic = 'force-dynamic'

const presets = Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, { required: v.required, hint: v.secret.hint }]))
const chip = { ok: ['succeeded', 'Verified'], failed: ['failed', 'Failed'], none: ['queued', 'Not verified'] } as const

export default async function ConnectionSettings() {
  const { user, workspace } = await currentWorkspace()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const connections = await loadConnections(workspace.id)
  const admin = isAdmin(user)
  return (
    <>
      {!connections.length && <EmptyState text={`${workspace.name} has no Connections yet.`} />}
      {connections.length > 0 && (
        <div className="scroll">
          <table className="table">
            <thead><tr><th>Name</th><th>Kind</th><th>Preset</th><th>Status</th><th /></tr></thead>
            <tbody>
              {connections.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.kind}</td>
                  <td>{c.provider || <span className="muted">n/a</span>}</td>
                  <td>
                    {c.kind === 'llm-provider' ? (
                      <>
                        <span className={`chip label ${chip[c.status][0]}`}>{chip[c.status][1]}</span>{' '}
                        {c.detail && <span className="small muted">{c.status === 'ok' ? c.detail.slice(0, 16).replace('T', ' ') : c.detail}</span>}
                      </>
                    ) : <span className="muted">n/a</span>}
                  </td>
                  <td>
                    {admin && (
                      <div className="row-between">
                        <details className="edit"><summary className="btn">Edit</summary>
                          <div className="card-lg"><ConnectionForm presets={presets} value={{ id: c.id, name: c.name, kind: c.kind, provider: c.provider, config: c.config }} /></div>
                        </details>
                        {c.kind === 'llm-provider' && (
                          <SettingsForm action={verifyConnection} submit="Verify again" inline><input type="hidden" name="id" value={c.id} /></SettingsForm>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {admin && (
        <section className="card-lg stack">
          <h2 className="heading">Add Connection</h2>
          <ConnectionForm presets={presets} submit="Add Connection" reset />
        </section>
      )}
    </>
  )
}
