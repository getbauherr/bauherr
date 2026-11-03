import Link from 'next/link'
import { EmptyState } from '../../../components/EmptyState'
import { StatusWord } from '../../../components/SettingsParts'
import { Button } from '../../../components/ui/button'
import { isAdmin, loadProducts } from '../../../lib/settings'
import { currentWorkspace } from '../../../lib/session'

export const dynamic = 'force-dynamic'

export default async function ProductList() {
  const { user, workspace } = await currentWorkspace()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const { products } = await loadProducts(workspace.id)
  const admin = isAdmin(user)
  return (
    <>
      <div className="row-between">
        <h2 className="heading">Products</h2>
        {admin && <Button asChild><Link href="/settings/products/new">Add Product</Link></Button>}
      </div>
      {!products.length ? (
        admin ? <EmptyState text="Add your first Product to let Bauherr work on a repository." action={{ href: '/settings/products/new', label: 'Add Product' }} /> : <EmptyState text="No Products yet. Ask an Admin to add one." />
      ) : (
        <div className="scroll">
          <table className="table ptable">
            <thead><tr><th>Product</th><th>Repository</th><th>Setup</th><th>Production approval</th></tr></thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td><Link href={`/settings/products/${p.id}`}>{p.name}</Link><div className="mono muted small">{p.slug}</div></td>
                  <td className="mono" data-label="Repository">{p.repositories.map((r) => r.fullName).join(', ')}</td>
                  <td data-label="Setup"><StatusWord tone={p.setup.open ? 'warn' : 'ok'}>{p.setup.open ? `${p.setup.open} ${p.setup.open === 1 ? 'step' : 'steps'} left` : 'Ready'}</StatusWord></td>
                  <td data-label="Production approval"><StatusWord tone={p.setup.production === 'Off' ? 'muted' : p.setup.production === 'On' ? 'ok' : 'warn'}>{p.setup.production}</StatusWord></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
