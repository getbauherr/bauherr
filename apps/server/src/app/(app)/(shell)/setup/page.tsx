import Link from 'next/link'
import { AutoRefresh } from '../../components/AutoRefresh'
import { EmptyState } from '../../components/EmptyState'
import { IntakeStep } from '../../components/setup/IntakeStep'
import { SettingsForm, Field } from '../../components/SettingsForm'
import { ConnectionForm } from '../../components/SettingsConnectionForm'
import { StatusCallout } from '../../components/SettingsParts'
import { IssuePick } from '../../components/setup/IssuePick'
import { PresetPicker } from '../../components/setup/PresetPicker'
import { ProductPick } from '../../components/setup/ProductPick'
import { RepoOptions } from '../../components/setup/RepoOptions'
import { SessionConnect } from '../../components/setup/SessionConnect'
import { SetupRail } from '../../components/setup/SetupRail'
import { StepCard } from '../../components/setup/StepCard'
import { SessionList } from '../../components/team/SessionList'
import { Tab, Tabs } from '../../components/ui/tabs'
import { Button } from '../../components/ui/button'
import { shownStep, loadSetup, SETUP_STEPS } from '../../lib/setup'
import { connectionPresets, isAdmin } from '../../lib/settings'
import { currentWorkspace, payloadClient } from '../../lib/session'
import { loadTeam } from '../../../../lib/sessions'
import { PRESETS, PRESET_TEXT, presetFacts, presetWorkflow, rosterOf } from '../../../../lib/presets'
import { Suspense } from 'react'
import { mintOwnAgentKey } from '../settings/actions'
import { skipSession } from './actions'
import { verifyConnection } from '../settings/actions'

export const dynamic = 'force-dynamic'

const DOCS = 'https://github.com/getbauherr/bauherr/blob/main/docs/session-mode.md#connect-as-a-role'

export default async function Setup({ searchParams }: { searchParams: Promise<{ step?: string; tab?: string }> }) {
  const { user, workspace } = await currentWorkspace()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  if (!isAdmin(user)) return <EmptyState text="Ask an Admin to finish setup." />
  const setup = await loadSetup(workspace.id)
  const { step, tab } = await searchParams
  const shown = shownStep(setup.steps, step)
  const n = SETUP_STEPS.findIndex(([id]) => id === shown) + 1
  const pending = setup.forges.find((c) => c.status !== 'ok')
  const verified = setup.forges.filter((c) => c.status === 'ok')
  return (
    <>
      <h1 className="title">Set up your Workspace</h1>
      <SetupRail steps={setup.steps} shown={shown} />
      {!shown && <Finish product={setup.product!} runner={setup.facts.llmConnection} session={setup.facts.sessionEver} />}
      {shown === 'forge' && (
        <StepCard id="forge" n={n} title="Connect your forge" purpose="Bauherr reads issues and opens pull requests with this account." later={{ text: 'Add or change accounts in', href: '/settings/connections', label: 'Settings › Workspace › Connections' }}>
          {pending && (
            <SettingsForm action={verifyConnection} submit="Verify" primary>
              <input type="hidden" name="id" value={pending.id} />
              <p>{pending.name}: {pending.status === 'failed' ? pending.detail : pending.inUse ? 'In use: its tickets are being read. Verify to confirm the token.' : 'Not verified yet.'}</p>
            </SettingsForm>
          )}
          <ConnectionForm presets={connectionPresets} submit={pending ? 'Add another Connection' : 'Add Connection'} reset primary={!pending} />
        </StepCard>
      )}
      {shown === 'product' && (
        <StepCard id="product" n={n} title="Pick a product" purpose="A product is one repository; its open issues become tickets." later={{ text: 'Rename it or add repositories in', href: '/settings/products', label: 'Settings › Workspace › Products' }}>
          <ProductPick connections={verified}>
            <Suspense fallback={<p className="small text-muted-foreground" role="status">Loading your repositories…</p>}>
              <RepoOptions connection={verified[0]!.id} />
            </Suspense>
          </ProductPick>
        </StepCard>
      )}
      {shown === 'team' && (
        <StepCard id="team" n={n} title="Pick your team" purpose="Who works on your tickets, and where you are asked." later={{ text: 'Change models and agents on', href: '/team', label: 'Agent team' }}>
          <PresetPicker presets={PRESETS.map((id) => ({ id, ...PRESET_TEXT[id], ...presetFacts(presetWorkflow(id)), team: rosterOf(presetWorkflow(id)) }))} />
        </StepCard>
      )}
      {shown === 'session' && <SessionStep workspace={workspace.id} runner={setup.facts.llmConnection} n={n} />}
      {shown === 'request' && setup.product && (
        <StepCard id="request" n={n} title="First request" purpose={`Give ${setup.product.name} something to do; the factory takes it into Triage.`} later={{ text: 'File more tickets on', href: '/requests/new', label: 'Requests' }}>
          <Tabs aria-label="First request">
            <Tab href="/setup" aria-current={tab === 'new' ? undefined : 'page'}>Pick an open issue</Tab>
            <Tab href="/setup?tab=new" aria-current={tab === 'new' ? 'page' : undefined}>Describe something new</Tab>
          </Tabs>
          {tab === 'new' ? <IntakeStep userId={user.id as number} products={[setup.product]} /> : <IssuePick product={setup.product.id} />}
        </StepCard>
      )}
    </>
  )
}

/** Step 4: the Runner or your own sessions. Reads the database only; the sessions list refreshes while the page is open. */
async function SessionStep({ workspace, runner, n }: { workspace: number; runner: boolean; n: number }) {
  const team = await loadTeam(await payloadClient(), workspace)
  const connected = team.roles.filter((r) => r.sessions.length)
  const mcpLine = `claude mcp add --transport http bauherr ${process.env.PUBLIC_URL ?? 'http://localhost:3000'}/mcp --header "Authorization: Bearer <your agent key>"`
  return (
    <StepCard id="session" n={n} title="Connect a session" purpose="Work gets done by the built-in Runner or by your own Claude Code sessions." later={{ text: 'Add more keys in', href: '/settings/api-key', label: 'Settings › Account › API keys' }}>
      <AutoRefresh />
      <p className="small">
        <strong>Built-in Runner:</strong> nothing to do, it needs an LLM Connection.{' '}
        {runner ? <span className="text-ok">An LLM Connection exists.</span> : <>None yet: <Link className="text-primary" href="/settings/connections">add one in Settings › Workspace › Connections</Link>.</>}
      </p>
      <p className="small"><strong>Your own sessions:</strong> create a key, add the factory to Claude Code, start a session as a role.</p>
      <SessionConnect roles={team.roles.filter((r) => r.stages.length).map(({ id, title }) => ({ id, title }))} mcpLine={mcpLine} docsHref={DOCS}>
        <SettingsForm action={mintOwnAgentKey} submit="Create agent key" primary reset copy>
          <Field name="label" label="Label" hint="Where it runs, e.g. laptop" />
        </SettingsForm>
      </SessionConnect>
      {connected.length ? <SessionList roles={connected} orphans={[]} /> : <p className="small text-muted-foreground" role="status">Waiting for a session…</p>}
      <SettingsForm action={skipSession} submit="Skip for now" />
    </StepCard>
  )
}

function Finish({ product, runner, session }: { product: { id: number; name: string }; runner: boolean; session: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <StatusCallout tone="ok" lead="Done">Your factory is set up. Next:</StatusCallout>
      <ol className="m-0 flex list-decimal flex-col gap-1 pl-5">
        <li>The factory triages your request.</li>
        <li>It asks you questions in the Inbox.</li>
        <li>You approve the plan, then it builds.</li>
      </ol>
      {!runner && !session && (
        <StatusCallout tone="warn" lead="Nothing will pick up work yet">No session is connected and there is no LLM Connection for the Runner. <Link className="text-primary" href="/setup?step=session">Connect a session</Link></StatusCallout>
      )}
      <div className="flex flex-wrap gap-3">
        <Button asChild><Link href="/">Open the Workflow</Link></Button>
        <Button asChild variant="outline"><Link href="/inbox">Open the Inbox</Link></Button>
      </div>
      <p className="small text-muted-foreground">Staging and production checks are asked for when a ticket first reaches release. Set them any time in <Link className="text-primary" href={`/settings/products/${product.id}?tab=deploy#production`}>{product.name} settings</Link>.</p>
    </div>
  )
}
