import Link from 'next/link'
import { notFound } from 'next/navigation'
import { EmptyState } from '../../../../components/EmptyState'
import { Field, SettingsForm } from '../../../../components/SettingsForm'
import { GateRow, RadioCards, SettingsSection, SetupChecklist, StatusCallout, ToggleRow } from '../../../../components/SettingsParts'
import { isAdmin, loadProduct } from '../../../../lib/settings'
import { currentWorkspace } from '../../../../lib/session'
import { addRepository, mintEmbedToken, removeDoc, revokeEmbedToken, saveDeploy } from '../../actions'

export const dynamic = 'force-dynamic'

const when = (iso: string) => iso.slice(0, 16).replace('T', ' ')
const onOff = (v: boolean) => (v ? 'On' : 'Off')

const Remove = ({ collection, id, label }: { collection: string; id: number; label: string }) => (
  <SettingsForm action={removeDoc} submit={label} confirm="Confirm remove" inline>
    <input type="hidden" name="collection" value={collection} />
    <input type="hidden" name="id" value={id} />
  </SettingsForm>
)

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, workspace } = await currentWorkspace()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const data = await loadProduct(workspace.id, Number((await params).id))
  if (!data) notFound()
  const { product: p, connections, workflow } = data
  const admin = isAdmin(user)
  const d = p.deploy
  const active = p.embedTokens.filter((e) => !e.revokedAt)
  const revoked = p.embedTokens.filter((e) => e.revokedAt)
  const orphans = p.sources.filter((s) => !p.repositories.some((r) => r.fullName === s.repo))
  const checks = d.productionChecks.split(',').map((c) => c.trim()).filter(Boolean)

  const settings = (
    <>
      <SettingsSection id="staging" n={2} title="Staging" purpose="How merged changes reach the site where you try them." advanced={
        <Field name="deployChecks" label="Which checks mean deployed to staging?" hint="Check names, comma-separated. Empty: all checks must be green. Use this if a slow or optional check should not hold up staging." example="deploy-staging" defaultValue={d.checks} />
      }>
        <RadioCards name="deployMode" legend="How do merged changes reach staging?" value={d.mode} options={[
          { value: 'observe-ci', title: 'My CI deploys to staging', text: 'Bauherr waits until the checks on the merge commit are green.' },
          { value: 'webhook', title: 'Bauherr calls my deploy hook', text: 'Bauherr sends one request to your URL, then waits until the staging site answers.' },
        ]} />
        <Field name="stagingUrl" label="Staging site" type="url" hint="Where you try changes before they go live. The Ticket shows an Open staging button." example="https://staging.acme.com" defaultValue={d.stagingUrl} />
        <div className="only-webhook">
          <Field name="deployWebhookUrl" label="Deploy hook URL" type="url" hint="Bauherr POSTs {ticket, sha, stagingUrl} here once per merge." example="https://ci.acme.com/hooks/staging" defaultValue={d.webhookUrl} />
        </div>
      </SettingsSection>

      <SettingsSection id="approvals" n={3} title="Approvals" purpose="Where the process waits for you. Everything else runs on its own.">
        <div>
          <GateRow label="Answer questions" help="Before planning, the agent asks you what is unclear." state="Always on" />
          <GateRow label="Approve the plan" help="You approve the plan before any code is written." state={onOff(workflow.plan)} />
          <GateRow label="Accept on staging" help="You check the change on staging before it moves on. When off, Bauherr accepts automatically once staging is confirmed." state={onOff(workflow.staging)} />
          <ToggleRow name="productionGate" label="Ask me before production" help="Nothing goes live until you press Approve production on the Ticket. Your own pipeline does the deploy." defaultChecked={p.productionOn} disabled={workflow.forcesProduction} reason={workflow.forcesProduction ? 'On for every Product by the workflow.' : undefined} />
          <ToggleRow name="autoMerge" label="Merge automatically" help="After a clean review and green checks, Bauherr merges the change itself. Off: you merge on GitHub." defaultChecked={d.autoMerge} />
        </div>
        <p className="small muted">The plan and staging approvals are set by the workflow for all Products.{admin && <> <Link href="/settings/workflow">See the workflow</Link>.</>}</p>
        <Field name="gateOwners" label="Who approves?" hint="GitHub logins, comma-separated. They are assigned on GitHub and mentioned when a Ticket waits for an approval. Empty: all Admins with a GitHub login." example="sbuckpesch" defaultValue={d.gateOwners} />
      </SettingsSection>

      <div className="only-production">
        <SettingsSection id="production" n={4} title="Production" purpose="How Bauherr knows your production deploy finished." advanced={
          <Field name="productionWebhookUrl" label="Also call this URL when I approve" type="url" hint="Optional. Bauherr POSTs {ticket, sha, environment: production} once per approval. Use it if your pipeline cannot listen for the GitHub label." example="https://ci.acme.com/hooks/prod" defaultValue={d.productionWebhookUrl} />
        }>
          {checks.length ? (
            <StatusCallout tone="ok" lead="Ready">After you accept on staging, Approve production appears on the Ticket. Bauherr then watches <span className="mono">{checks.join(', ')}</span>.</StatusCallout>
          ) : (
            <StatusCallout tone="warn" lead="Not ready">Pick the check that reports your production deploy. Until then Tickets stop at Configure production checks.</StatusCallout>
          )}
          <Field name="productionChecks" label="Which check reports the production deploy?" hint="Bauherr marks the deploy as done when these checks succeed on the approved commit. Check names, comma-separated." example="deploy-production" defaultValue={d.productionChecks} />
          <details className="small muted">
            <summary>How does my pipeline know when to deploy?</summary>
            <p>When you approve, Bauherr adds the label <span className="mono">bauherr:approved:production</span> to the issue and, if set, calls your URL. Your pipeline deploys and reports a check on the approved commit. Report it on the commit from the Ticket, not on the latest main. Bauherr watches that check and closes the Ticket when it succeeds.</p>
          </details>
        </SettingsSection>
      </div>

      <SettingsSection id="release" n={5} title="Release notes" purpose="Release notes are written when you approve production.">
        <RadioCards name="releaseMode" legend="Who makes the release?" value={d.releaseMode} options={[
          { value: 'notes-only', title: 'My tooling makes releases', text: 'Bauherr adds plain-language notes to the release your tooling creates.' },
          { value: 'factory', title: 'Bauherr makes the release', text: 'Bauherr tags the version, publishes the release and opens a CHANGELOG change for you to merge.' },
        ]} />
      </SettingsSection>
    </>
  )

  return (
    <>
      <div className="stack-1">
        <p className="small muted"><Link href="/settings/products">Products</Link> / {p.name}</p>
        <h2 className="heading">{p.name}</h2>
      </div>
      {!admin && <p className="small muted">Only an Admin can change Product settings.</p>}
      <SetupChecklist rows={p.setup.rows} />

      <SettingsSection id="repository" n={1} title="Repository and tickets" purpose="The code the agents work in and where new Tickets come from." advanced={
        <>
          <p className="small muted">Short name <span className="mono">{p.slug}</span>. It names the Knowledge repo folder and cannot change.</p>
          {p.sources.map((s) => (
            <div key={s.id} className="row-between">
              <span className="small">Last checked <span className="mono">{when(s.polledAt)}</span> ({s.connection}), position <span className="mono">{s.cursor || 'none'}</span></span>
              {admin && <Remove collection="ticket_sources" id={s.id} label="Stop reading tickets" />}
            </div>
          ))}
          {admin && p.repositories.map((r) => <div key={r.id} className="row-between"><span className="mono small">{r.fullName}</span><Remove collection="repositories" id={r.id} label="Remove repository" /></div>)}
        </>
      }>
        {(p.repositories.length > 0 || orphans.length > 0) && (
          <div className="scroll">
            <table className="table">
              <thead><tr><th>Repository</th><th>Reads tickets</th></tr></thead>
              <tbody>
                {p.repositories.map((r) => <tr key={r.id}><td className="mono">{r.fullName}</td><td>{p.sources.some((s) => s.repo === r.fullName) ? 'Yes' : 'No'}</td></tr>)}
                {orphans.map((s) => <tr key={`s${s.id}`}><td className="mono">{s.repo}</td><td>Yes</td></tr>)}
              </tbody>
            </table>
          </div>
        )}
        {admin && (connections.length ? (
          <SettingsForm action={addRepository} submit="Add repository" reset>
            <input type="hidden" name="id" value={p.id} />
            <Field name="fullName" label="Repository" hint="The code repository the agents work in." example="acme/shop" required />
            <Field name="connection" label="Account" hint="The GitHub or GitLab account Bauherr uses to read and write this repository." options={connections.map((c) => [String(c.id), c.name])} />
            <ToggleRow name="readTickets" label="Read tickets from this repository" help="Bauherr picks up new issues from this repository as Tickets." defaultChecked />
          </SettingsForm>
        ) : (
          <EmptyState text="Bauherr needs access to GitHub or GitLab first." action={{ href: '/settings/connections', label: 'Add connection' }} />
        ))}
      </SettingsSection>

      {admin ? <SettingsForm action={saveDeploy} submit="Save changes" primary bar><input type="hidden" name="id" value={p.id} />{settings}</SettingsForm> : <fieldset disabled className="stack">{settings}</fieldset>}

      <SettingsSection id="widget" n={6} title="Website widget" purpose="Lets your users send requests from your own site." advanced={revoked.length > 0 && (
        <div className="scroll">
          <table className="table">
            <thead><tr><th>Revoked widgets</th><th>Sites</th><th>Revoked</th></tr></thead>
            <tbody>{revoked.map((e) => <tr key={e.id}><td>{e.name}</td><td className="mono">{e.origins}</td><td className="mono">{when(e.revokedAt)}</td></tr>)}</tbody>
          </table>
        </div>
      )}>
        {active.length > 0 ? (
          <div className="scroll">
            <table className="table">
              <thead><tr><th>Name</th><th>Sites</th><th>Created</th><th /></tr></thead>
              <tbody>
                {active.map((e) => (
                  <tr key={e.id}>
                    <td>{e.name}</td><td className="mono">{e.origins}</td><td className="mono">{when(e.createdAt)}</td>
                    <td>{admin && <SettingsForm action={revokeEmbedToken} submit="Revoke" confirm="Confirm revoke" inline><input type="hidden" name="id" value={e.id} /></SettingsForm>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="small muted">No website widget yet. Add one to collect requests from your users.</p>
        )}
        {admin && (
          <SettingsForm action={mintEmbedToken} submit="Add widget" reset copy>
            <input type="hidden" name="id" value={p.id} />
            <Field name="name" label="Name" hint="So you recognise it later." example="Shop footer" required />
            <Field name="origins" label="Sites that may show the widget" hint="One address per line. The widget only works on these sites. The code to paste is shown once, before the closing body tag." example="https://shop.acme.com" rows={3} required />
          </SettingsForm>
        )}
      </SettingsSection>

      {admin && (
        <SettingsSection id="danger" title="Delete Product">
          {p.blocked ? (
            <p className="small muted">Cannot delete yet: still referenced by {p.blocked}. Remove those first.</p>
          ) : (
            <>
              <p className="small muted">Permanently deletes this Product. It must have nothing attached: no repositories, ticket sources, Tickets, widget tokens or requests.</p>
              <Remove collection="products" id={p.id} label="Delete Product" />
            </>
          )}
        </SettingsSection>
      )}
    </>
  )
}
