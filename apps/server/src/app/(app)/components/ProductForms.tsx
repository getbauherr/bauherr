import Link from 'next/link'
import type { loadProduct } from '../lib/settings'
import { Field } from './SettingsForm'
import { GateRow, RadioCards, SettingsSection, StatusCallout, ToggleRow } from './SettingsParts'

const onOff = (v: boolean) => (v ? 'On' : 'Off')

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

/** Staging, Approvals and Production sections of a Product (page `/settings/products/<id>` and step 3 of /setup); render inside the form that saves them. */
export function DeploySections({ data: { product: p, workflow }, admin, numbered }: { data: NonNullable<Awaited<ReturnType<typeof loadProduct>>>; admin: boolean; numbered?: boolean }) {
  const d = p.deploy
  const checks = d.productionChecks.split(',').map((c) => c.trim()).filter(Boolean)
  const num = (i: number) => (numbered ? i + 2 : undefined)
  return (
    <>
      <SettingsSection id="staging" n={num(0)} title="Staging" purpose="How merged changes reach the site where you try them." advanced={
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


      <SettingsSection id="approvals" n={num(1)} title="Approvals" purpose="Where the process waits for you. Everything else runs on its own.">
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
        <SettingsSection id="production" n={num(2)} title="Production" purpose="How Bauherr knows your production deploy finished." advanced={
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

    </>
  )
}
