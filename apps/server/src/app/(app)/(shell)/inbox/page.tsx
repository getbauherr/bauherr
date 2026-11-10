import Link from 'next/link'
import { EmptyState } from '../../components/EmptyState'
import { InboxList } from '../../components/InboxList'
import { Badge } from '../../components/ui/badge'
import { loadInbox } from '../../lib/inbox'
import { currentWorkspace } from '../../lib/session'

export const dynamic = 'force-dynamic'

export default async function Inbox({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const { user, workspace } = await currentWorkspace()
  const { product } = await searchParams
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const { groups, products, working } = await loadInbox(workspace.id, user, /^\d+$/.test(product ?? '') ? Number(product) : undefined)
  const count = groups.reduce((n, g) => n + g.items.length, 0)
  return (
    <>
      <h1 className="title">Inbox</h1>
      {products.length > 1 && (
        <nav aria-label="Product" className="flex flex-wrap gap-2">
          {[{ id: 0, name: 'All products' }, ...products].map((p) => {
            const active = (Number(product) || 0) === p.id
            return (
              <Link key={p.id} href={p.id ? `/inbox?product=${p.id}` : '/inbox'} aria-current={active ? 'page' : undefined}>
                <Badge variant={active ? 'accent' : 'neutral'}>{p.name}</Badge>
              </Link>
            )
          })}
        </nav>
      )}
      {count ? (
        <>
          <p className="small text-muted-foreground">{count} decision{count === 1 ? '' : 's'} wait for you.</p>
          <div className="max-w-[760px]"><InboxList groups={groups} admin={user.role === 'admin'} /></div>
        </>
      ) : (
        <EmptyState text={`Nothing needs you. The factory is working on ${working} ticket${working === 1 ? '' : 's'}.`} action={{ href: '/', label: 'Open the Tickets' }} />
      )}
    </>
  )
}
