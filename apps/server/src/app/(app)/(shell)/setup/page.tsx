import Link from 'next/link'
import { EmptyState } from '../../components/EmptyState'
import { IntakeChat } from '../../components/IntakeChat'
import { DeploySections, ProductNameFields, RepositoryFields } from '../../components/ProductForms'
import { SettingsForm } from '../../components/SettingsForm'
import { ConnectionForm } from '../../components/SettingsConnectionForm'
import { SettingsSection, SetupChecklist, StatusCallout } from '../../components/SettingsParts'
import { loadSetup } from '../../lib/setup'
import { connectionPresets, isAdmin, loadProduct } from '../../lib/settings'
import { currentWorkspace } from '../../lib/session'
import { createProductWithRepo, saveDeploy, skipDeploy, verifyConnection } from '../settings/actions'

export const dynamic = 'force-dynamic'

export default async function Setup({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const { user, workspace } = await currentWorkspace()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  if (!isAdmin(user)) return <EmptyState text="Ask an Admin to finish setup." />
  const { steps, current, github, forges, product } = await loadSetup(workspace.id)
  const first = steps.findIndex((s) => !s.done)
  const { step } = await searchParams
  const asked = steps.findIndex((s) => s.id === step)
  const shown = asked >= 0 && (first < 0 || asked <= first) ? steps[asked]!.id : current
  const n = steps.findIndex((s) => s.id === shown) + 1
  const pending = github.find((c) => c.status !== 'ok')
  const deploy = shown === 'deploy' && product ? await loadProduct(workspace.id, product.id) : undefined
  return (
    <>
      <h1 className="title">Set up your Workspace</h1>
      <SetupChecklist rows={steps.map((s) => ({ id: s.id, label: s.label, word: s.done ? 'Done' : 'To do', tone: s.done ? 'ok' : 'warn', href: `/setup?step=${s.id}` }))} />
      {!shown && <StatusCallout tone="ok" lead="Done">Your Workspace is set up. <Link href="/">Back to tickets</Link></StatusCallout>}
      {shown === 'connect' && (
        <SettingsSection id="connect" n={n} title="Connect GitHub" purpose="Bauherr reads issues and opens pull requests with this account.">
          {pending && (
            <SettingsForm action={verifyConnection} submit="Verify" primary>
              <input type="hidden" name="id" value={pending.id} />
              <p>{pending.name}: {pending.status === 'failed' ? pending.detail : 'Not verified yet.'}</p>
            </SettingsForm>
          )}
          <ConnectionForm presets={connectionPresets} submit={pending ? 'Add another Connection' : 'Add Connection'} reset primary={!pending} />
        </SettingsSection>
      )}
      {shown === 'product' && (
        <SettingsSection id="product" n={n} title="Add the first Product" purpose="Name it and point it at its repository; new issues become Tickets.">
          <SettingsForm action={createProductWithRepo} submit="Add Product" primary>
            <ProductNameFields />
            <RepositoryFields connections={forges} tickets={false} />
          </SettingsForm>
        </SettingsSection>
      )}
      {deploy && (
        <>
          <SettingsForm action={saveDeploy} submit="Save and continue" primary>
            <input type="hidden" name="id" value={deploy.product.id} />
            <DeploySections data={deploy} admin />
          </SettingsForm>
          <SettingsForm action={skipDeploy} submit="Skip, use defaults">
            <input type="hidden" name="id" value={deploy.product.id} />
          </SettingsForm>
        </>
      )}
      {shown === 'request' && product && (
        <SettingsSection id="request" n={n} title="First request" purpose={`Describe a small change for ${product.name}; Bauherr sends it to Triage.`}>
          <IntakeChat userId={user.id as number} products={[{ id: product.id, name: product.name }]} />
        </SettingsSection>
      )}
    </>
  )
}
