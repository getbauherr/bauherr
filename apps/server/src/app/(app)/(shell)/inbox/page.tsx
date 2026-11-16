import Link from 'next/link'
import { EmptyState } from '../../components/EmptyState'
import { InboxView } from '../../components/InboxView'
import { Badge } from '../../components/ui/badge'
import { CHECKPOINTS } from '../../../../lib/decision'
import { workflowFor } from '../../../../lib/factory'
import { byKind, graph } from '../../../../lib/workflow'
import { loadInbox } from '../../lib/inbox'
import { emptyCopy, inboxHref, resolveSelection } from '../../lib/inbox-view'
import { currentPersonWorkspace } from '../../lib/session'
import { isProductOwner } from '../../../../lib/people'

export const dynamic = 'force-dynamic'

export default async function Inbox({ searchParams }: { searchParams: Promise<{ product?: string; checkpoint?: string; t?: string }> }) {
  const { user, workspace } = await currentPersonWorkspace()
  const { product, checkpoint, t } = await searchParams
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const picked = CHECKPOINTS.find((c) => c === checkpoint)
  const filters = { product: /^\d+$/.test(product ?? '') ? Number(product) : undefined, checkpoint: picked }
  const owner = isProductOwner(user)
  const query = (p?: string, c?: string) => inboxHref({ product: Number(p) || undefined, checkpoint: c })
  let inbox
  try {
    inbox = await loadInbox(workspace.id, user, filters)
  } catch {
    return (
      <>
        <h1 className="title">Inbox</h1>
        <EmptyState {...emptyCopy({ error: true, owner, working: 0 })} />
      </>
    )
  }
  const { groups, products, working } = inbox
  const { selected, detail, stale } = resolveSelection(groups, /^\d+$/.test(t ?? '') ? Number(t) : undefined)
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
          {stale && <p role="status" className="small m-0 text-muted-foreground" data-testid="stale-selection">This decision is already taken.</p>}
          <InboxView groups={groups} selected={selected?.id ?? null} detail={detail} admin={user.role === 'admin'} filters={filters} workflowHref={owner ? {} : workflowHref} />
        </>
      ) : (
        <EmptyState {...emptyCopy({ picked, owner, working })} />
      )}
    </>
  )
}
