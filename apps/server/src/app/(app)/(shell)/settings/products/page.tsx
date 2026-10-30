import { EmptyState } from '../../../components/EmptyState'
import { Field, SettingsForm } from '../../../components/SettingsForm'
import { isAdmin, loadProducts } from '../../../lib/settings'
import { currentWorkspace } from '../../../lib/session'
import { createProduct, createRepository, createSource, removeDoc, saveDeploy } from '../actions'

export const dynamic = 'force-dynamic'

const Remove = ({ collection, id }: { collection: string; id: number }) => (
  <SettingsForm action={removeDoc} submit="Delete" confirm="Confirm delete" inline>
    <input type="hidden" name="collection" value={collection} />
    <input type="hidden" name="id" value={id} />
  </SettingsForm>
)

export default async function ProductSettings() {
  const { user, workspace } = await currentWorkspace()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const { products, connections } = await loadProducts(workspace.id)
  const admin = isAdmin(user)
  return (
    <>
      {!products.length && <EmptyState text={`${workspace.name} has no Products yet.`} />}
      {products.map((p) => (
        <section key={p.id} className="card-lg stack">
          <div className="row-between">
            <h2 className="heading">{p.name} <span className="mono muted">{p.slug}</span></h2>
            {admin && (p.blocked ? <span className="small muted">Cannot delete: referenced by {p.blocked}.</span> : <Remove collection="products" id={p.id} />)}
          </div>
          <div className="scroll">
            <table className="table">
              <thead><tr><th>Repository</th><th>Ticket source</th><th>Connection</th><th>Cursor</th><th>Last poll</th><th /></tr></thead>
              <tbody>
                {p.repositories.map((r) => {
                  const s = p.sources.find((x) => x.repo === r.fullName)
                  return (
                    <tr key={r.id}>
                      <td className="mono">{r.fullName}</td>
                      <td>{s ? 'polled' : <span className="muted">none</span>}</td>
                      <td>{s?.connection}</td>
                      <td className="mono">{s?.cursor}</td>
                      <td className="mono">{s?.polledAt.slice(0, 16).replace('T', ' ')}</td>
                      <td>{admin && <div className="row-between">{s && <Remove collection="ticket_sources" id={s.id} />}<Remove collection="repositories" id={r.id} /></div>}</td>
                    </tr>
                  )
                })}
                {p.sources.filter((s) => !p.repositories.some((r) => r.fullName === s.repo)).map((s) => (
                  <tr key={`s${s.id}`}>
                    <td className="mono">{s.repo}</td><td>polled</td><td>{s.connection}</td><td className="mono">{s.cursor}</td>
                    <td className="mono">{s.polledAt.slice(0, 16).replace('T', ' ')}</td><td>{admin && <Remove collection="ticket_sources" id={s.id} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <SettingsForm action={saveDeploy} submit="Save release settings">
            <input type="hidden" name="id" value={p.id} />
            <Field name="stagingUrl" label="Staging URL" type="url" defaultValue={p.deploy.stagingUrl} disabled={!admin} />
            <Field name="deployMode" label="Deploy" options={[['observe-ci', 'Observe CI'], ['webhook', 'Webhook']]} defaultValue={p.deploy.mode} disabled={!admin} />
            <Field name="deployWebhookUrl" label="Webhook URL (webhook mode)" type="url" defaultValue={p.deploy.webhookUrl} disabled={!admin} />
            <Field name="deployChecks" label="Required checks" hint="Comma-separated; empty = all must be green." defaultValue={p.deploy.checks} disabled={!admin} />
            <Field name="productionGate" label="Production gate" type="checkbox" defaultChecked={p.deploy.productionGate} disabled={!admin} />
          </SettingsForm>
          {admin && (
            <div className="forms">
              <SettingsForm action={createRepository} submit="Add repository" reset>
                <input type="hidden" name="id" value={p.id} />
                <Field name="fullName" label="Repository (owner/name)" required />
              </SettingsForm>
              <SettingsForm action={createSource} submit="Add ticket source" reset>
                <input type="hidden" name="id" value={p.id} />
                <Field name="repo" label="Repository" options={p.repositories.map((r) => r.fullName)} />
                <Field name="connection" label="Connection" options={connections.map((c) => [String(c.id), c.name])} />
              </SettingsForm>
            </div>
          )}
        </section>
      ))}
      {admin && (
        <section className="card-lg stack">
          <h2 className="heading">Add Product</h2>
          <SettingsForm action={createProduct} submit="Add Product" reset primary>
            <Field name="name" label="Name" required />
            <Field name="slug" label="Slug" required />
          </SettingsForm>
        </section>
      )}
    </>
  )
}
