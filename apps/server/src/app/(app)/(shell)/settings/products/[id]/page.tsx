import { PageTitle } from '../../../../components/PageTitle'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { EmptyState } from '../../../../components/EmptyState'
import { Table } from '../../../../components/ui/table'
import { Field, SettingsForm } from '../../../../components/SettingsForm'
import { ProductionGateSection, ProductionSection, RepositoryFields, StagingSection } from '../../../../components/ProductForms'
import { TabAnchors } from '../../../../components/TabAnchors'
import { Tab, Tabs } from '../../../../components/ui/tabs'
import { SettingsSection, SetupChecklist } from '../../../../components/SettingsParts'
import { isAdmin, loadProduct } from '../../../../lib/settings'
import { currentWorkspace } from '../../../../lib/session'
import { addRepository, removeDoc, saveDeploy, savePathSets } from '../../actions'

export const dynamic = 'force-dynamic'

const TABS = [['repository', 'Repository'], ['deploy', 'Deploy'], ['path-sets', 'Path sets'], ['danger', 'Danger zone']] as const
const TAB_OF: Record<string, string> = { repository: 'repository', staging: 'deploy', production: 'deploy', 'path-sets': 'path-sets', danger: 'danger' }

const when = (iso: string) => iso.slice(0, 16).replace('T', ' ')

const Remove = ({ collection, id, label }: { collection: string; id: number; label: string }) => (
  <SettingsForm action={removeDoc} submit={label} confirm="Confirm remove" inline>
    <input type="hidden" name="collection" value={collection} />
    <input type="hidden" name="id" value={id} />
  </SettingsForm>
)

export default async function ProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { user, workspace } = await currentWorkspace()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const data = await loadProduct(workspace.id, Number((await params).id))
  if (!data) notFound()
  const { product: p, connections } = data
  const admin = isAdmin(user)
  const base = `/settings/products/${p.id}`
  const wanted = (await searchParams).tab
  const tab = TABS.some(([t]) => t === wanted) && (wanted !== 'danger' || admin) ? wanted! : 'repository'
  const orphans = p.sources.filter((s) => !p.repositories.some((r) => r.fullName === s.repo))

  const form = (children: ReactNode) => admin ? (
    <SettingsForm action={saveDeploy} submit="Save changes" primary bar>
      <input type="hidden" name="id" value={p.id} />
      {children}
    </SettingsForm>
  ) : <fieldset disabled className="flex flex-col gap-4">{children}</fieldset>

  return (
    <>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="small text-muted-foreground"><Link href="/settings/products">Products</Link> / {p.name}</p>
        <PageTitle>{p.name}</PageTitle>
        <h2 className="heading">{p.name}</h2>
      </div>
      {!admin && <p className="small text-muted-foreground">Only an Admin can change Product settings.</p>}
      <SetupChecklist rows={p.setup.rows.map((r) => ({ ...r, href: `${base}?tab=${TAB_OF[r.id]}#${r.id}` }))} />
      <TabAnchors tabs={TAB_OF} current={tab} base={base} />
      <Tabs aria-label="Product" className="max-w-full overflow-x-auto whitespace-nowrap border-b border-border">
        {TABS.filter(([t]) => t !== 'danger' || admin).map(([t, label]) => <Tab key={t} href={t === 'repository' ? base : `${base}?tab=${t}`} aria-current={tab === t ? 'page' : undefined}>{label}</Tab>)}
      </Tabs>

      {tab === 'repository' && (
        <SettingsSection id="repository" title="Repository and tickets" purpose="The code the agents work in and where new Tickets come from." advanced={
          <>
            <p className="small text-muted-foreground">Short name <span className="mono">{p.slug}</span>. It cannot change.</p>
            {p.sources.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-3">
                <span className="small">Last checked <span className="mono">{when(s.polledAt)}</span> ({s.connection}), position <span className="mono">{s.cursor || 'none'}</span></span>
                {admin && <Remove collection="ticket_sources" id={s.id} label="Stop reading tickets" />}
              </div>
            ))}
            {admin && p.repositories.map((r) => <div key={r.id} className="flex flex-wrap items-center justify-between gap-3"><span className="mono small">{r.fullName}</span><Remove collection="repositories" id={r.id} label="Remove repository" /></div>)}
          </>
        }>
          {(p.repositories.length > 0 || orphans.length > 0) && (
            <Table>
              <thead><tr><th>Repository</th><th>Reads tickets</th></tr></thead>
              <tbody>
                {p.repositories.map((r) => <tr key={r.id}><td className="mono">{r.fullName}</td><td>{p.sources.some((s) => s.repo === r.fullName) ? 'Yes' : 'No'}</td></tr>)}
                {orphans.map((s) => <tr key={`s${s.id}`}><td className="mono">{s.repo}</td><td>Yes</td></tr>)}
              </tbody>
            </Table>
          )}
          {admin && (connections.length ? (
            <SettingsForm action={addRepository} submit="Add repository" reset>
              <input type="hidden" name="id" value={p.id} />
              <RepositoryFields connections={connections} />
            </SettingsForm>
          ) : (
            <EmptyState text="Bauherr needs access to GitHub or GitLab first." action={{ href: '/settings/connections', label: 'Add connection' }} />
          ))}
        </SettingsSection>
      )}

      {tab === 'deploy' && form(
        <>
          <StagingSection data={{ product: p }} />
          <ProductionGateSection data={{ product: p }} />
          {p.deploy.productionGate && <ProductionSection data={{ product: p }} />}
        </>,
      )}

      {tab === 'path-sets' && (
        <SettingsSection id="path-sets" title="Path sets" purpose="Named groups of paths, for example the paths that count as security-relevant.">
          {admin ? (
            <SettingsForm action={savePathSets}>
              <input type="hidden" name="id" value={p.id} />
              <Field name="sets" label="Path sets" hint="One set per line: its name, a colon, then paths separated by commas. A path may use * and **. A set without paths never matches." rows={5} defaultValue={p.pathSetsText} example="security: src/auth/**, src/api/**" />
            </SettingsForm>
          ) : (
            <p className="small mono whitespace-pre-line">{p.pathSetsText || 'None'}</p>
          )}
        </SettingsSection>
      )}

      {tab === 'danger' && admin && (
        <SettingsSection id="danger" title="Delete Product">
          {p.blocked ? (
            <p className="small text-muted-foreground">Cannot delete yet: still referenced by {p.blocked}. Remove those first.</p>
          ) : (
            <>
              <p className="small text-muted-foreground">Permanently deletes this Product. It must have nothing attached: no repositories or ticket sources.</p>
              <Remove collection="products" id={p.id} label="Delete Product" />
            </>
          )}
        </SettingsSection>
      )}
    </>
  )
}
