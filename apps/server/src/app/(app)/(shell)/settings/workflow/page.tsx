import { notFound } from 'next/navigation'
import { EmptyState } from '../../../components/EmptyState'
import { isAdmin, loadWorkflow } from '../../../lib/settings'
import { currentWorkspace } from '../../../lib/session'
import type { HumanGate } from '../../../../../lib/mode'
import { GATE_NAMES } from '../../../../../lib/needs-you'

const TOUCH_POINTS: { id: HumanGate; when: string; what: string; where: string }[] = [
  { id: 'refine', when: 'Before planning', what: 'Answer the critical questions of a Triage or plan sheet.', where: 'Ticket page decision sheet or forge comment' },
  { id: 'plan', when: 'Before Build', what: 'Read the plan and approve it (refused while critical decisions are open).', where: 'Ticket page gate or label bauherr:approved:plan' },
  { id: 'staging', when: 'After the merge request is merged and deployed to staging', what: 'Check staging, then accept or request changes.', where: 'Ticket page gate' },
  { id: 'production', when: 'Before the production deploy', what: "Approve so the Product's own pipeline deploys.", where: 'Ticket page gate' },
]

export const dynamic = 'force-dynamic'

export default async function Workflow() {
  const { user, workspace } = await currentWorkspace()
  if (!isAdmin(user)) notFound()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const w = await loadWorkflow(workspace.id)
  return (
    <>
      <h2 className="heading">Where you are asked</h2>
      <p className="small muted">The points where the factory waits for you, in flow order.</p>
      <div className="scroll">
        <table className="table">
          <thead><tr><th>Name</th><th>When</th><th>On/Off</th></tr></thead>
          <tbody>
            {TOUCH_POINTS.map((t) => (
              <tr key={t.id}><td>{GATE_NAMES[t.id]}</td><td>{t.when}</td><td>{w.gates.includes(t.id) ? 'On' : t.id === 'production' ? 'Per Product' : 'Off'}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <details>
        <summary>Details</summary>
        <div className="stack">
        <h2 className="heading">What you do and where</h2>
        <div className="scroll">
          <table className="table">
            <thead><tr><th>Name</th><th>What you do</th><th>Where</th></tr></thead>
            <tbody>
              {TOUCH_POINTS.map((t) => (
                <tr key={t.id}><td>{GATE_NAMES[t.id]}</td><td>{t.what}</td><td>{t.where}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      <h2 className="heading">Stages</h2>
      <p className="small muted">The base workflow with the run mode each stage has in this Workspace. Read-only.</p>
      <div className="scroll">
        <table className="table">
          <thead><tr><th>Stage</th><th>Mode</th><th>Gate</th><th>Steps</th></tr></thead>
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
        </div>
      </details>
    </>
  )
}
