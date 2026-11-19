import { type ComponentProps, Suspense, cache } from 'react'
import { namesOf, productionCallouts, productionWorkflow } from '../lib/product-setup'
import { type RecentCheck, recentChecks } from '../lib/settings'
import { CopyField, Field, MultiPick } from './SettingsForm'
import { RadioCards, SettingsSection, StatusCallout, ToggleRow } from './SettingsParts'

const CHECKS_UNREADABLE = 'Could not read checks from GitHub right now. Type the check name instead.'

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

const ChecksPick = (props: PickProps & { product: number }) => (
  <Suspense fallback={<MultiPick {...props} options={[]} notice="Loading recent checks from the forge…" />}>
    <LoadedChecksPick {...props} />
  </Suspense>
)

async function LoadedCallouts({ product, checks }: { product: number; checks: string[] }) {
  const seen = (await checksFor(product))?.map((c) => c.name) ?? null
  return productionCallouts({ checks, seen }).map((c) => <StatusCallout key={c.lead} tone={c.tone} lead={c.lead}>{c.text}</StatusCallout>)
}

type Product = { id: number; deploy: { stagingUrl: string; mode: string; webhookUrl: string; checks: string; productionGate: boolean; productionWebhookUrl: string; productionChecks: string } }
type SectionProps = { data: { product: Product }; n?: number }

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

export function ProductionGateSection({ data: { product: p }, n }: SectionProps) {
  return (
    <SettingsSection id="approvals" n={n} title="Production approval" purpose="Whether production waits for you.">
      <input type="hidden" name="productionGateShown" value="1" />
      <ToggleRow name="productionGate" label="Ask me before production" help="Nothing goes live until you approve it. Your own pipeline does the deploy." defaultChecked={p.deploy.productionGate} />
    </SettingsSection>
  )
}

export function ProductionSection({ data: { product: p }, n }: SectionProps) {
  const d = p.deploy
  const production = namesOf(d.productionChecks)
  return (
    <SettingsSection id="production" n={n} title="Production" purpose="How Bauherr knows your production deploy finished." advanced={
      <Field name="productionWebhookUrl" label="Also call this URL when I approve" type="url" hint="Optional. Bauherr POSTs {ticket, sha, environment: production} once per approval. Use it if your pipeline cannot listen for the GitHub label." example="https://ci.acme.com/hooks/prod" defaultValue={d.productionWebhookUrl} />
    }>
      <Suspense fallback={null}><LoadedCallouts product={p.id} checks={production} /></Suspense>
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
