import Link from 'next/link'
import { type ComponentProps, Suspense, cache } from 'react'
import { namesOf, productionCallouts, productionWorkflow } from '../lib/product-setup'
import { type loadProduct, type RecentCheck, recentChecks } from '../lib/settings'
import { CopyField, Field, MultiPick } from './SettingsForm'
import { GateLadder, RadioCards, SettingsSection, StatusCallout, ToggleRow } from './SettingsParts'

const CHECKS_UNREADABLE = 'Could not read checks from GitHub right now. Type the check name instead.'

/** Repository, account and (optionally) "read tickets" of an Add repository form. */
export const RepositoryFields = ({ connections, tickets = true }: { connections: { id: number; name: string }[]; tickets?: boolean }) => (
  <>
    <Field name="fullName" label="Repository" hint="The code repository the agents work in." example="acme/shop" required />
    <Field name="connection" label="Account" hint="The GitHub or GitLab account Bauherr uses to read and write this repository." options={connections.map((c) => [String(c.id), c.name])} />
    {tickets && <ToggleRow name="readTickets" label="Read tickets from this repository" help="Bauherr picks up new issues from this repository as Tickets." defaultChecked />}
  </>
)

const checksFor = cache(recentChecks)
const optionsOf = (checks: RecentCheck[] | null) => (checks ?? []).map((c) => ({ value: c.name, meta: `seen on ${c.seen} of ${c.of} recent commits · last: ${c.lastConclusion}` }))

type PickProps = Omit<ComponentProps<typeof MultiPick>, 'options' | 'notice'>

async function LoadedChecksPick({ product, ...pick }: PickProps & { product: number }) {
  const checks = await checksFor(product)
  return <MultiPick {...pick} options={optionsOf(checks)} notice={checks ? undefined : CHECKS_UNREADABLE} />
}

/** A check picker that renders at once with the saved names and receives the forge's recent check names (`recentChecks`, 3 s, null when unreadable) when they arrive; only the picker is replaced, the rest of the form keeps what was typed. */
const ChecksPick = (props: PickProps & { product: number }) => (
  <Suspense fallback={<MultiPick {...props} options={[]} notice="Loading recent checks from the forge…" />}>
    <LoadedChecksPick {...props} />
  </Suspense>
)

async function LoadedCallouts({ product, checks, notifiable }: { product: number; checks: string[]; notifiable: boolean }) {
  const seen = (await checksFor(product))?.map((c) => c.name) ?? null
  return productionCallouts({ checks, seen, notifiable, on: true }).map((c) => <StatusCallout key={c.lead} tone={c.tone} lead={c.lead}>{c.text}</StatusCallout>)
}

type Data = NonNullable<Awaited<ReturnType<typeof loadProduct>>>
type SectionProps = { data: Data; admin?: boolean; n?: number; retries?: boolean }

/** Staging section of a Product (the Deploy tab and step 3 of /setup). */
export function StagingSection({ data: { product: p }, n }: SectionProps) {
  const d = p.deploy
  return (
    <SettingsSection id="staging" n={n} title="Staging" purpose="How merged changes reach the site where you try them." advanced={
      <ChecksPick product={p.id} name="deployChecks" legend="Which checks mean deployed to staging?" hint="Empty: all checks must be green. Pick some if a slow or optional check should not hold up staging." value={namesOf(d.checks)} addLabel="Add a check that has not run yet" example="deploy-staging" missingMeta="not seen recently" />
    }>
      <RadioCards name="deployMode" legend="How do merged changes reach staging?" value={d.mode} options={[
        { value: 'observe-ci', title: 'My CI deploys to staging', text: 'Bauherr waits until the checks on the merge commit are green.' },
        { value: 'webhook', title: 'Bauherr calls my deploy hook', text: 'Bauherr sends one request to your URL, then waits until the staging site answers.' },
      ]} />
      <Field name="stagingUrl" label="Staging site" type="url" hint="Where you try changes before they go live. The Ticket shows an Open staging button." example="https://staging.acme.com" defaultValue={d.stagingUrl} />
      <div className="[form:has(input[name=deployMode][value=observe-ci]:checked)_&]:hidden">
        <Field name="deployWebhookUrl" label="Deploy hook URL" type="url" hint="Bauherr POSTs {ticket, sha, stagingUrl} here once per merge." example="https://ci.acme.com/hooks/staging" defaultValue={d.webhookUrl} />
      </div>
    </SettingsSection>
  )
}

/** Re-run of a failed check (the Checks & merging tab; inside the Approvals section of /setup). */
export const CheckRetriesField = ({ value }: { value: number }) => (
  <Field name="checkRetries" label="Re-run a failed check once" type="number" min={0} max={1} hint="1: a failed check is re-run once before it sends the change back or stops a release. 0 turns this off." defaultValue={value} />
)

/** Approvals section of a Product (the Approvals tab and step 3 of /setup); renders the gate ladder with the production switch. */
export function ApprovalsSection({ data: { product: p, workflow, members, adminApprover }, admin, n, retries = true }: SectionProps) {
  const d = p.deploy
  const admins = members.filter((m) => m.admin).map((m) => `@${m.login}`)
  const notifiable = !!d.gateOwners || adminApprover
  const [off] = productionCallouts({ checks: namesOf(d.productionChecks), seen: null, notifiable, on: false })
  return (
    <SettingsSection id="approvals" n={n} title="Approvals" purpose="Where the process waits for you. Everything else runs on its own.">
      <GateLadder plan={workflow.plan} staging={workflow.staging}>
        <ToggleRow name="productionGate" label="Ask me before production" help="Nothing goes live until you press Approve production on the Ticket. Your own pipeline does the deploy." defaultChecked={p.productionOn} disabled={workflow.forcesProduction} reason={workflow.forcesProduction ? 'On for every Product by the workflow.' : undefined} />
      </GateLadder>
      <div className="[form:has(input[name=productionGate]:checked)_&]:hidden">
        <StatusCallout tone="muted" lead={off!.lead}>{off!.text}</StatusCallout>
      </div>
      <p className="small text-muted-foreground">The plan and staging approvals are set by the workflow for all Products.{admin && <> <Link href="/workflow/edit">See the workflow</Link>.</>}</p>
      <ToggleRow name="autoMerge" label="Merge automatically" help="After a clean review and green checks, Bauherr merges the change itself. Off: you merge on GitHub." defaultChecked={d.autoMerge} />
      {workflow.staging && <ToggleRow name="expediteSkipStaging" label="Skip staging approval for Hotfixes" help="A Hotfix Ticket moves on from staging without your Accept. The production approval still waits for you." defaultChecked={d.expediteSkipStaging} />}
      {retries && <CheckRetriesField value={d.checkRetries} />}
      <MultiPick
        name="gateOwners"
        legend="Who approves?"
        hint="They are assigned on GitHub and mentioned when a Ticket waits for an approval."
        options={members.map((m) => ({ value: m.login, label: `${m.email} · @${m.login}` }))}
        value={namesOf(d.gateOwners)}
        addLabel="Add GitHub login"
        example="sbuckpesch"
        missingMeta="not a Member with this login"
        emptyNote={adminApprover ? (admins.length ? `Nobody picked: all Admins with a GitHub login (${admins.join(', ')}).` : 'Nobody picked: all Admins with a GitHub login.') : undefined}
        login
        mono={false}
      />
    </SettingsSection>
  )
}

/** Production section of a Product (the Deploy tab when the production gate is on, and step 3 of /setup). */
export function ProductionSection({ data: { product: p, adminApprover }, n }: SectionProps) {
  const d = p.deploy
  const production = namesOf(d.productionChecks)
  const notifiable = !!d.gateOwners || adminApprover
  return (
    <SettingsSection id="production" n={n} title="Production" purpose="How Bauherr knows your production deploy finished." advanced={
      <Field name="productionWebhookUrl" label="Also call this URL when I approve" type="url" hint="Optional. Bauherr POSTs {ticket, sha, environment: production} once per approval. Use it if your pipeline cannot listen for the GitHub label." example="https://ci.acme.com/hooks/prod" defaultValue={d.productionWebhookUrl} />
    }>
      <Suspense fallback={null}><LoadedCallouts product={p.id} checks={production} notifiable={notifiable} /></Suspense>
      <ChecksPick product={p.id} name="productionChecks" legend="Which check reports the production deploy?" hint="Bauherr marks the deploy as done when these checks succeed on the approved commit." value={production} addLabel="Add a check that has not run yet" example="deploy-production" missingMeta="not seen recently" />
      <details className="small text-muted-foreground">
        <summary className="cursor-pointer">How does my pipeline know when to deploy?</summary>
        <div className="flex flex-col gap-4 mt-3">
          <p>When you approve, Bauherr adds the label <span className="mono">bauherr:approved:production</span> to the issue and, if set, calls your URL. Your pipeline deploys and reports a check on the approved commit. Report it on the commit from the Ticket, not on the latest main. Bauherr watches that check and closes the Ticket when it succeeds.</p>
          <p>GitHub Actions example: a workflow that runs when the label is added and reports <span className="mono">{production.join(', ') || 'deploy-production'}</span> on the Ticket&apos;s merge commit.</p>
          <CopyField block text={productionWorkflow(production.length ? production : ['deploy-production'])} />
        </div>
      </details>
    </SettingsSection>
  )
}

/** Staging, Approvals and Production in one go (step 3 of /setup); render inside the form that saves them. Reads only the database; the forge-backed parts (check pickers, "Ready" callout) stream in. */
export function DeploySections({ data, admin, numbered }: { data: Data; admin: boolean; numbered?: boolean }) {
  const num = (i: number) => (numbered ? i + 2 : undefined)
  return (
    <>
      <StagingSection data={data} n={num(0)} />
      <ApprovalsSection data={data} admin={admin} n={num(1)} />
      <div className="[form:not(:has(input[name=productionGate]:checked))_&]:hidden">
        <ProductionSection data={data} n={num(2)} />
      </div>
    </>
  )
}
