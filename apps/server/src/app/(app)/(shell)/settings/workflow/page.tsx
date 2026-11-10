import { notFound } from 'next/navigation'
import { EmptyState } from '../../../components/EmptyState'
import { GateRow, GateLadder, ToggleRow } from '../../../components/SettingsParts'
import { Field, SettingsForm } from '../../../components/SettingsForm'
import { Table } from '../../../components/ui/table'
import { saveExpediteLane, saveOverlapIgnore, saveWipLimits, suggestOverlapPaths } from '../actions'
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
      <h2 className="heading">Board &amp; WIP</h2>
      <h3 id="wip" className="heading">WIP limits</h3>
      <p className="small text-muted-foreground">Tickets allowed per Board column; empty means no limit. A Ticket waits in the column to its left until the next one has room. Work already in a column always finishes: merges, staging, production and returns are never held. Sub-tickets count, parents do not. Applied on the next poll.</p>
      <SettingsForm action={saveWipLimits}>
        <div className="grid grid-cols-3 gap-4 max-sm:grid-cols-1">
          {w.wip.map((c) => (
            <Field key={c.stage} name={`wip_${c.stage}`} label={`${c.stage[0].toUpperCase()}${c.stage.slice(1)} (now ${c.count})`} type="number" min={1} step={1} defaultValue={c.limit ?? ''} />
          ))}
        </div>
      </SettingsForm>
      <h2 className="heading">Expedite lane</h2>
      <SettingsForm action={saveExpediteLane}>
        <ToggleRow name="expediteLane" label="Expedite lane" help="A Ticket labelled bauherr:expedite skips Triage, ignores WIP limits and the overlap hold and needs no plan approval; one at a time per Workspace. Off: the label is ignored with a Comment." defaultChecked={w.expediteLane} />
      </SettingsForm>
      <h2 className="heading">Paths that never hold a Build</h2>
      <p className="small text-muted-foreground">A Build does not start while an earlier Ticket in Build or Review changes the same paths (from the plan&apos;s Files section, then the pull request). Paths listed here never hold anything. One path glob per line.</p>
      {w.overlap.map((p) => (
        <section key={p.id} className="flex flex-col gap-4">
          <h3 className="small font-medium text-foreground">{p.name}</h3>
          <SettingsForm action={saveOverlapIgnore}>
            <input type="hidden" name="id" value={p.id} />
            <Field name="ignore" label={`Paths that never hold a Build (${p.name})`} rows={4} defaultValue={p.ignore.join('\n')} example="pnpm-lock.yaml" />
          </SettingsForm>
          <SettingsForm action={suggestOverlapPaths} submit="Suggest paths" inline>
            <input type="hidden" name="id" value={p.id} />
            <span className="small text-muted-foreground">{p.suggestedAt ? `Suggested ${p.suggestedAt.slice(0, 16).replace('T', ' ')} from the last 100 merged pull requests.` : 'Not suggested yet. Reads the last 100 merged pull requests from the forge.'}</span>
          </SettingsForm>
          {p.suggestions.length > 0 && (
            <>
              <p className="small text-muted-foreground">Changed in at least 25% of the last 100 merged pull requests. Nothing is applied until you add it.</p>
              <ul>
                {p.suggestions.map((x) => (
                  <li key={x.path}>
                    <SettingsForm action={saveOverlapIgnore} submit="Add" inline>
                      <input type="hidden" name="id" value={p.id} />
                      <input type="hidden" name="add" value={x.path} />
                      <span className="mono">{x.path}</span> <span className="small text-muted-foreground">{x.percent}%</span>
                    </SettingsForm>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      ))}
      <h2 className="heading">Where you are asked</h2>
      <p className="small text-muted-foreground">The points where the factory waits for you, in flow order. Approve the plan and Accept on staging are set here for all Products; Ask me before production is set per Product.</p>
      <GateLadder plan={w.ladder.plan} staging={w.ladder.staging}>
        <GateRow label="Ask me before production" help="Nothing goes live until you press Approve production on the Ticket. On the Ticket, after staging." state={w.ladder.production ? 'On for every Product' : 'Per Product'} />
      </GateLadder>
      <details>
        <summary>Details</summary>
        <div className="flex flex-col gap-4">
        <h2 className="heading">What you do and where</h2>
        <Table>
            <thead><tr className="label"><th>Name</th><th>When</th><th>What you do</th><th>Where</th></tr></thead>
            <tbody>
              {TOUCH_POINTS.map((t) => (
                <tr key={t.id}><td>{GATE_NAMES[t.id]}</td><td>{t.when}</td><td>{t.what}</td><td>{t.where}</td></tr>
              ))}
            </tbody>
          </Table>
      <h2 className="heading">Stages</h2>
      <p className="small text-muted-foreground">The base workflow with the run mode each stage has in this Workspace. Read-only.</p>
      <Table>
            <thead><tr className="label"><th>Stage</th><th>Mode</th><th>Gate</th><th>Steps</th></tr></thead>
          <tbody>
            {w.stages.map((s) => (
              <tr key={s.name}><td>{s.name}</td><td>{s.mode}</td><td>{s.gate || '—'}</td><td>{s.steps.join(', ') || '—'}</td></tr>
            ))}
          </tbody>
        </Table>
      <h2 className="heading">Compiled per Product</h2>
      {!w.versions.length ? (
        <EmptyState text="No Products yet." />
      ) : (
        <Table>
            <thead><tr className="label"><th>Product</th><th>Version</th><th>Compiled</th><th>Knowledge overlay</th></tr></thead>
            <tbody>
              {w.versions.map((v) => (
                <tr key={v.product}>
                  <td>{v.product}</td>
                  <td>{v.version ?? <span className="text-muted-foreground">none</span>}</td>
                  <td>{v.at ? new Date(v.at).toISOString().slice(0, 16).replace('T', ' ') : '—'}</td>
                  <td>{v.version == null ? '—' : v.overlay ? 'differs from base' : 'none'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
      )}
        </div>
      </details>
    </>
  )
}
