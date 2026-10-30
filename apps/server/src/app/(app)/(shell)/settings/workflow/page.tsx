import { notFound } from 'next/navigation'
import { EmptyState } from '../../../components/EmptyState'
import { isAdmin, loadWorkflow } from '../../../lib/settings'
import { currentWorkspace } from '../../../lib/session'

export const dynamic = 'force-dynamic'

export default async function Workflow() {
  const { user, workspace } = await currentWorkspace()
  if (!isAdmin(user)) notFound()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const w = await loadWorkflow(workspace.id)
  return (
    <>
      <h2 className="heading">Stages</h2>
      <p className="small muted">The base workflow (pack/workflow.yaml) with the run mode each stage has in this Workspace. Read-only.</p>
      <div className="scroll">
        <table className="table">
          <thead><tr><th>Stage</th><th>Mode</th><th>Gate before</th><th>Steps</th></tr></thead>
          <tbody>
            {w.stages.map((s) => (
              <tr key={s.name}><td>{s.name}</td><td>{s.mode}</td><td>{s.gate || '—'}</td><td>{s.steps.join(', ') || '—'}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2 className="heading">Compiled per Product</h2>
      {!w.versions.length ? (
        <EmptyState text="No Products yet." />
      ) : (
        <div className="scroll">
          <table className="table">
            <thead><tr><th>Product</th><th>Version</th><th>Compiled</th><th>Knowledge overlay</th></tr></thead>
            <tbody>
              {w.versions.map((v) => (
                <tr key={v.product}>
                  <td>{v.product}</td>
                  <td>{v.version ?? <span className="muted">none</span>}</td>
                  <td>{v.at ? new Date(v.at).toISOString().slice(0, 16).replace('T', ' ') : '—'}</td>
                  <td>{v.version == null ? '—' : v.overlay ? 'differs from base' : 'none'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
