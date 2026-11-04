import Link from 'next/link'
import { namesOf, productionCallouts, productionWorkflow } from '../lib/product-setup'
import type { loadProduct, RecentCheck } from '../lib/settings'
import { CopyField, Field, MultiPick } from './SettingsForm'
import { GateLadder, RadioCards, SettingsSection, StatusCallout, ToggleRow } from './SettingsParts'

const CHECKS_UNREADABLE = 'Could not read checks from GitHub right now. Type the check name instead.'

/** Name and the optional short name of a new Product (`/settings/products/new` and /setup). */
export const ProductNameFields = () => (
  <>
    <Field name="name" label="Product name" hint="What you call this product on the Board and in Tickets." example="Acme Shop" required />
    <details className="advanced">
      <summary className="small">Advanced</summary>
      <div className="mt-3">
        <Field name="slug" label="Short name" hint="Used in links and in the Knowledge repo folder products/<short name>/. Empty: derived from the name." example="acme-shop" />
      </div>
    </details>
  </>
)

/** Repository, account and (optionally) "read tickets" of an Add repository form. */
export const RepositoryFields = ({ connections, tickets = true }: { connections: { id: number; name: string }[]; tickets?: boolean }) => (
  <>
    <Field name="fullName" label="Repository" hint="The code repository the agents work in." example="acme/shop" required />
    <Field name="connection" label="Account" hint="The GitHub or GitLab account Bauherr uses to read and write this repository." options={connections.map((c) => [String(c.id), c.name])} />
    {tickets && <ToggleRow name="readTickets" label="Read tickets from this repository" help="Bauherr picks up new issues from this repository as Tickets." defaultChecked />}
  </>
)

/** Staging, Approvals and Production sections of a Product (page `/settings/products/<id>` and step 3 of /setup); render inside the form that saves them. `checks` are the recent check names from the forge (`recentChecks`), null when it could not be read. */
export function DeploySections({ data: { product: p, workflow, members }, checks, admin, numbered }: { data: NonNullable<Awaited<ReturnType<typeof loadProduct>>>; checks: RecentCheck[] | null; admin: boolean; numbered?: boolean }) {
  const d = p.deploy
  const production = namesOf(d.productionChecks)
  const num = (i: number) => (numbered ? i + 2 : undefined)
  const options = (checks ?? []).map((c) => ({ value: c.name, meta: `seen on ${c.seen} of ${c.of} recent commits · last: ${c.lastConclusion}` }))
  const unreadable = checks?.length ? undefined : CHECKS_UNREADABLE
  const admins = members.filter((m) => m.admin).map((m) => `@${m.login}`)
  const status = { checks: production, seen: checks?.map((c) => c.name) ?? null, notifiable: !!d.gateOwners || admins.length > 0 }
  const [off] = productionCallouts({ ...status, on: false })
  return (
    <>
      <SettingsSection id="staging" n={num(0)} title="Staging" purpose="How merged changes reach the site where you try them." advanced={
        <MultiPick name="deployChecks" legend="Which checks mean deployed to staging?" hint="Empty: all checks must be green. Pick some if a slow or optional check should not hold up staging." options={options} value={namesOf(d.checks)} addLabel="Add a check that has not run yet" example="deploy-staging" missingMeta="not seen recently" notice={unreadable} />
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


      <SettingsSection id="approvals" n={num(1)} title="Approvals" purpose="Where the process waits for you. Everything else runs on its own.">
        <GateLadder plan={workflow.plan} staging={workflow.staging}>
          <ToggleRow name="productionGate" label="Ask me before production" help="Nothing goes live until you press Approve production on the Ticket. Your own pipeline does the deploy." defaultChecked={p.productionOn} disabled={workflow.forcesProduction} reason={workflow.forcesProduction ? 'On for every Product by the workflow.' : undefined} />
        </GateLadder>
        <div className="only-off">
          <StatusCallout tone="muted" lead={off!.lead}>{off!.text}</StatusCallout>
        </div>
        <p className="small muted">The plan and staging approvals are set by the workflow for all Products.{admin && <> <Link href="/settings/workflow">See the workflow</Link>.</>}</p>
        <ToggleRow name="autoMerge" label="Merge automatically" help="After a clean review and green checks, Bauherr merges the change itself. Off: you merge on GitHub." defaultChecked={d.autoMerge} />
        <Field name="checkRetries" label="Re-run a failed check once" type="number" min={0} max={1} hint="1: a failed check is re-run once before it sends the change back or stops a release. 0 turns this off." defaultValue={d.checkRetries} />
        <MultiPick
          name="gateOwners"
          legend="Who approves?"
          hint="They are assigned on GitHub and mentioned when a Ticket waits for an approval."
          options={members.map((m) => ({ value: m.login, label: `${m.email} · @${m.login}` }))}
          value={namesOf(d.gateOwners)}
          addLabel="Add GitHub login"
          example="sbuckpesch"
          missingMeta="not a Member with this login"
          emptyNote={admins.length ? `Nobody picked: all Admins with a GitHub login (${admins.join(', ')}).` : undefined}
          login
          mono={false}
        />
      </SettingsSection>


      <div className="only-production">
        <SettingsSection id="production" n={num(2)} title="Production" purpose="How Bauherr knows your production deploy finished." advanced={
          <Field name="productionWebhookUrl" label="Also call this URL when I approve" type="url" hint="Optional. Bauherr POSTs {ticket, sha, environment: production} once per approval. Use it if your pipeline cannot listen for the GitHub label." example="https://ci.acme.com/hooks/prod" defaultValue={d.productionWebhookUrl} />
        }>
          {productionCallouts({ ...status, on: true }).map((c) => <StatusCallout key={c.lead} tone={c.tone} lead={c.lead}>{c.text}</StatusCallout>)}
          <MultiPick name="productionChecks" legend="Which check reports the production deploy?" hint="Bauherr marks the deploy as done when these checks succeed on the approved commit." options={options} value={production} addLabel="Add a check that has not run yet" example="deploy-production" missingMeta="not seen recently" notice={unreadable} />
          <details className="small muted">
            <summary>How does my pipeline know when to deploy?</summary>
            <div className="stack mt-3">
              <p>When you approve, Bauherr adds the label <span className="mono">bauherr:approved:production</span> to the issue and, if set, calls your URL. Your pipeline deploys and reports a check on the approved commit. Report it on the commit from the Ticket, not on the latest main. Bauherr watches that check and closes the Ticket when it succeeds.</p>
              <p>GitHub Actions example: a workflow that runs when the label is added and reports <span className="mono">{production[0] ?? 'deploy-production'}</span> on the Ticket&apos;s merge commit.</p>
              <CopyField block text={productionWorkflow(production[0] ?? 'deploy-production')} />
            </div>
          </details>
        </SettingsSection>
      </div>

    </>
  )
}
