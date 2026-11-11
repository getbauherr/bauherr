import { PageTitle } from '../../../../components/PageTitle'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { EmptyState } from '../../../../components/EmptyState'
import { Table } from '../../../../components/ui/table'
import { Field, SettingsForm } from '../../../../components/SettingsForm'
import { ApprovalsSection, CheckRetriesField, ProductionSection, RepositoryFields, StagingSection } from '../../../../components/ProductForms'
import { TabAnchors } from '../../../../components/TabAnchors'
import { Tab, Tabs } from '../../../../components/ui/tabs'
import { RadioCards, SettingsSection, SetupChecklist, ToggleRow } from '../../../../components/SettingsParts'
import { isAdmin, loadProduct } from '../../../../lib/settings'
import { currentWorkspace } from '../../../../lib/session'
import { addRepository, mintEmbedToken, redetectMerge, removeDoc, revokeEmbedToken, saveDeploy, saveMergeMode, saveSecurityScan, startScan } from '../../actions'

export const dynamic = 'force-dynamic'

const TABS = [['repository', 'Repository'], ['deploy', 'Deploy'], ['approvals', 'Approvals'], ['checks', 'Checks & merging'], ['releases', 'Releases'], ['security', 'Security scan'], ['widget', 'Widget'], ['danger', 'Danger zone']] as const
/** Section anchor -> tab, for the setup checklist and for links that name a section (`#production`). */
const TAB_OF: Record<string, string> = { repository: 'repository', staging: 'deploy', production: 'deploy', approvals: 'approvals', 'pre-review': 'checks', merging: 'checks', release: 'releases', security: 'security', widget: 'widget', danger: 'danger' }

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
  const data = await loadProduct(workspace.id, Number((await params).id), isAdmin(user))
  if (!data) notFound()
  const { product: p, connections, scan } = data
  const admin = isAdmin(user)
  const d = p.deploy
  const base = `/settings/products/${p.id}`
  const wanted = (await searchParams).tab
  const tab = TABS.some(([t]) => t === wanted) && (wanted !== 'danger' || admin) ? wanted! : 'repository'
  const active = p.embedTokens.filter((e) => !e.revokedAt)
  const revoked = p.embedTokens.filter((e) => e.revokedAt)
  const orphans = p.sources.filter((s) => !p.repositories.some((r) => r.fullName === s.repo))

  /** One form per tab: only that tab's fields are posted and saved (`section`). */
  const form = (section: string, children: ReactNode) => admin ? (
    <SettingsForm action={saveDeploy} submit="Save changes" primary bar>
      <input type="hidden" name="id" value={p.id} />
      <input type="hidden" name="section" value={section} />
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
            <p className="small text-muted-foreground">Short name <span className="mono">{p.slug}</span>. It names the Knowledge repo folder and cannot change.</p>
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

      {tab === 'deploy' && form('deploy', (
        <>
          <StagingSection data={data} />
          {p.productionOn ? <ProductionSection data={data} /> : (
            <SettingsSection id="production" title="Production" purpose="How Bauherr knows your production deploy finished."><p className="small text-muted-foreground">Production checks apply when Ask me before production is on. Turn it on under Approvals.</p></SettingsSection>
          )}
        </>
      ))}

      {tab === 'approvals' && form('approvals', <ApprovalsSection data={data} admin={admin} retries={false} />)}

      {tab === 'checks' && (
        <>
          {form('checks', (
            <>
              <SettingsSection id="pre-review" title="Pre-review checks" purpose="Checks on the changed file paths that a change must pass before it goes to review. Empty: off.">
                <Field name="reviewChecks" label="Rules" hint="One rule per line. Globs are comma-separated. Start a line with schema: for a changed schema file that needs a changed migration file; the line evidence needs a done or deferred row per plan step." example="src/**, apps/** => tests/**" rows={4} defaultValue={p.reviewChecks} />
                <CheckRetriesField value={d.checkRetries} />
              </SettingsSection>
            </>
          ))}
          <SettingsSection id="merging" title="Merging" purpose="How a clean change gets onto the main branch.">
            <p className="small text-muted-foreground" data-testid="merge-mode">Detected mode: <span className="mono">{p.merge.mode}</span>{p.merge.preflight && <> · checked <span className="mono">{when(p.merge.preflight.at)}</span></>}</p>
            {p.merge.preflight && !p.merge.preflight.ok && (
              <ul className="small" data-testid="merge-problems">{p.merge.preflight.problems.map((x) => <li key={x}>{x}</li>)}</ul>
            )}
            {admin && (
              <>
                <SettingsForm action={saveMergeMode} submit="Save merge mode">
                  <input type="hidden" name="id" value={p.id} />
                  <Field name="mergeMode" label="Merge mode" hint="direct: Bauherr squash-merges the change itself. queue: Bauherr hands the reviewed commit to the forge's merge queue and waits. train: for forges without a merge queue, Bauherr tests the queued changes together on its own bauherr/train branch (CI must run on it) and merges them in order." defaultValue={p.merge.mode} options={['direct', 'queue', 'train']} />
                </SettingsForm>
                <SettingsForm action={redetectMerge} submit="Re-detect" inline>
                  <input type="hidden" name="id" value={p.id} />
                </SettingsForm>
              </>
            )}
          </SettingsSection>
        </>
      )}

      {tab === 'releases' && form('releases', (
        <SettingsSection id="release" title="Release notes" purpose="Release notes are written when you approve production.">
          <div className="flex flex-col gap-4 [&:not(:has(input[value=manual]:checked))_.reminder]:hidden [&:not(:has(input[value=factory]:checked))_.prerelease]:hidden">
            <RadioCards name="releaseMode" legend="Who makes the release?" value={d.releaseMode} options={[
              { value: 'notes-only', title: 'My tooling makes releases', text: 'Bauherr adds plain-language notes to the release your tooling creates.' },
              { value: 'factory', title: 'Bauherr makes the release', text: 'Bauherr tags the version, publishes the release and opens a CHANGELOG change for you to merge.' },
              { value: 'manual', title: 'I ship releases myself', text: 'Nothing is released automatically: you pick the done Tickets and ship them from the Releases page, and Bauherr reminds you when they wait too long.' },
            ]} />
            <div className="reminder"><Field name="releaseReminderDays" label="Remind me after (days)" hint="Only for I ship releases myself: the Board reminds you when done Tickets wait longer than this for a release." type="number" min={1} step={1} defaultValue={d.releaseReminderDays} /></div>
            <div className="prerelease"><ToggleRow name="releasePrerelease" label="Publish releases as pre-release (rc)" help="Only for Bauherr makes the release: publishes v<next>-rc.N as a pre-release instead of a stable version, and opens no CHANGELOG change." defaultChecked={d.releasePrerelease} /></div>
          </div>
        </SettingsSection>
      ))}

      {tab === 'security' && (
        <SettingsSection id="security" title="Security scan" purpose="A read-only Run that reviews the repository against the Product's SECURITY-CONTEXT.md in the Knowledge repo. It writes no code and opens no MR.">
          <p className="small text-muted-foreground" data-testid="last-scan">
            Last scan <span className="mono">{p.securityScan.lastScanAt ? when(p.securityScan.lastScanAt) : 'never'}</span>
            {scan.run && <> · <Link href={`/runs/${scan.run.id}`}>Run #{scan.run.id}</Link> ({scan.run.status})</>}
            {scan.tickets.length > 0 && <> · Findings: {scan.tickets.map((t, i) => <span key={t.id}>{i > 0 && ', '}<Link href={`/tickets/${t.id}`}>#{t.number}</Link></span>)}</>}
          </p>
          {admin && (
            <>
              <SettingsForm action={saveSecurityScan} submit="Save scan settings">
                <input type="hidden" name="id" value={p.id} />
                <ToggleRow name="enabled" label="Scan on a schedule" help="The hourly security-scan tick starts a scan when the schedule below is due." defaultChecked={p.securityScan.enabled} />
                <Field name="cron" label="Schedule" hint="6-field cron, seconds first. Default: Mondays 04:00." defaultValue={p.securityScan.cron} />
                <Field name="maxBudgetUsd" label="Budget per scan (USD)" hint="Empty: 2. Never above 10." type="number" step="any" defaultValue={p.securityScan.maxBudgetUsd} />
                <Field name="maxTurns" label="Turns per scan" hint="Empty: 30." type="number" defaultValue={p.securityScan.maxTurns} />
              </SettingsForm>
              <SettingsForm action={startScan} submit="Scan now" inline>
                <input type="hidden" name="id" value={p.id} />
              </SettingsForm>
            </>
          )}
        </SettingsSection>
      )}

      {tab === 'widget' && (
        <SettingsSection id="widget" title="Website widget" purpose="Lets your users send requests from your own site." advanced={revoked.length > 0 && (
          <Table>
            <thead><tr><th>Revoked widgets</th><th>Sites</th><th>Revoked</th></tr></thead>
            <tbody>{revoked.map((e) => <tr key={e.id}><td>{e.name}</td><td className="mono">{e.origins}</td><td className="mono">{when(e.revokedAt)}</td></tr>)}</tbody>
          </Table>
        )}>
          {active.length > 0 ? (
            <Table>
              <thead><tr><th>Name</th><th>Sites</th><th>Sessions per hour</th><th>Created</th><th /></tr></thead>
              <tbody>
                {active.map((e) => (
                  <tr key={e.id}>
                    <td>{e.name}</td><td className="mono">{e.origins}</td><td className="mono">{e.maxSessionsPerHour}</td><td className="mono">{when(e.createdAt)}</td>
                    <td>{admin && <SettingsForm action={revokeEmbedToken} submit="Revoke" confirm="Confirm revoke" inline><input type="hidden" name="id" value={e.id} /></SettingsForm>}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="small text-muted-foreground">No website widget yet. Add one to collect requests from your users.</p>
          )}
          {admin && (
            <SettingsForm action={mintEmbedToken} submit="Add widget" reset copy>
              <input type="hidden" name="id" value={p.id} />
              <Field name="name" label="Name" hint="So you recognise it later." example="Shop footer" required />
              <Field name="origins" label="Sites that may show the widget" hint="One address per line. The widget only works on these sites. The code to paste is shown once, before the closing body tag." example="https://shop.acme.com" rows={3} required />
              <Field name="maxSessionsPerHour" label="Sessions per hour" hint="How many conversations this widget may start per hour. Empty: 20." type="number" min={1} step={1} />
            </SettingsForm>
          )}
        </SettingsSection>
      )}

      {tab === 'danger' && admin && (
        <SettingsSection id="danger" title="Delete Product">
          {p.blocked ? (
            <p className="small text-muted-foreground">Cannot delete yet: still referenced by {p.blocked}. Remove those first.</p>
          ) : (
            <>
              <p className="small text-muted-foreground">Permanently deletes this Product. It must have nothing attached: no repositories, ticket sources, Tickets, widget tokens or requests.</p>
              <Remove collection="products" id={p.id} label="Delete Product" />
            </>
          )}
        </SettingsSection>
      )}
    </>
  )
}
