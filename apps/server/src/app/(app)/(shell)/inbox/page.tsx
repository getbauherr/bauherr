import Link from 'next/link'
import { EmptyState } from '../../components/EmptyState'
import { InboxList } from '../../components/InboxList'
import { Badge } from '../../components/ui/badge'
import { CHECKPOINTS } from '../../../../lib/decision'
import { workflowFor } from '../../../../lib/factory'
import { byKind, graph } from '../../../../lib/workflow'
import { loadInbox } from '../../lib/inbox'
import { currentWorkspace } from '../../lib/session'

export const dynamic = 'force-dynamic'

export default async function Inbox({ searchParams }: { searchParams: Promise<{ product?: string; checkpoint?: string }> }) {
  const { user, workspace } = await currentWorkspace()
  const { product, checkpoint } = await searchParams
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const { groups, products, working } = await loadInbox(workspace.id, user, { product: /^\d+$/.test(product ?? '') ? Number(product) : undefined, checkpoint: CHECKPOINTS.find((c) => c === checkpoint) })
  const picked = CHECKPOINTS.find((c) => c === checkpoint)
  const query = (p?: string, c?: string) => { const q = new URLSearchParams(); if (p) q.set('product', p); if (c) q.set('checkpoint', c); return q.size ? `/inbox?${q}` : '/inbox' }
  const wf = workflowFor(workspace.id)
  const nodes = graph(wf).nodes
  const workflowHref = Object.fromEntries(CHECKPOINTS.flatMap((c) => { const id = nodes.find((n) => n.checkpoint && n.id.includes(':') && n.title === c)?.id ?? (c === 'Review' ? byKind(wf, 'review')?.name : undefined); return id ? [[c, `/?stage=${encodeURIComponent(id)}`]] : [] }))
  const count = groups.reduce((n, g) => n + g.items.length, 0)
  return (
    <>
      <h1 className="title">Inbox</h1>
      {products.length > 1 && (
        <nav aria-label="Product" className="flex flex-wrap gap-2">
          {[{ id: 0, name: 'All products' }, ...products].map((p) => {
            const active = (Number(product) || 0) === p.id
            return (
              <Link key={p.id} href={query(p.id ? String(p.id) : undefined, picked)} aria-current={active ? 'page' : undefined}>
                <Badge variant={active ? 'accent' : 'neutral'}>{p.name}</Badge>
              </Link>
            )
          })}
        </nav>
      )}
      {picked && (
        <p className="small m-0 flex items-center gap-2" data-testid="checkpoint-filter">
          <span className="text-muted-foreground">Showing</span>
          <Link href={query(product, undefined)} aria-label={`Remove the filter ${picked}`} title="Remove the filter"><Badge variant="accent">{picked} ×</Badge></Link>
        </p>
      )}
      {count ? (
        <>
          <p className="small text-muted-foreground">{count} decision{count === 1 ? '' : 's'} wait for you.</p>
          <div className="max-w-[760px]"><InboxList groups={groups} admin={user.role === 'admin'} workflowHref={workflowHref} /></div>
        </>
      ) : (
        <EmptyState text={picked ? `Nothing waits for you at ${picked}.` : `Nothing needs you. The factory is working on ${working} ticket${working === 1 ? '' : 's'}.`} action={picked ? { href: '/inbox', label: 'Show all decisions' } : { href: '/', label: 'Open the Workflow' }} />
      )}
    </>
  )
}
