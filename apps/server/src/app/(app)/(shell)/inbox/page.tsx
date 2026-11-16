import { EmptyState } from '../../components/EmptyState'
import { InboxAnnouncer, InboxView } from '../../components/InboxView'
import { InboxFilterBar } from '../../components/InboxFilterBar'
import { CHECKPOINTS } from '../../../../lib/decision'
import { workflowFor } from '../../../../lib/factory'
import { byKind, graph } from '../../../../lib/workflow'
import { loadInbox } from '../../lib/inbox'
import { emptyCopy, resolveSelection } from '../../lib/inbox-view'
import { currentPersonWorkspace } from '../../lib/session'
import { isProductOwner } from '../../../../lib/people'

export const dynamic = 'force-dynamic'

export default async function Inbox({ searchParams }: { searchParams: Promise<{ product?: string; checkpoint?: string; t?: string }> }) {
  const { user, workspace } = await currentPersonWorkspace()
  const { product, checkpoint, t } = await searchParams
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const picked = CHECKPOINTS.find((c) => c === checkpoint)
  const filters = { product: /^\d{1,9}$/.test(product ?? '') ? Number(product) : undefined, checkpoint: picked }
  const owner = isProductOwner(user)
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
  const { groups, counts, products, working } = inbox
  const total = Object.values(counts).reduce((n, c) => n + c, 0)
  const { selected, detail, stale } = resolveSelection(groups, /^\d{1,9}$/.test(t ?? '') ? Number(t) : undefined)
  const wf = workflowFor(workspace.id)
  const nodes = graph(wf).nodes
  const workflowHref = Object.fromEntries(CHECKPOINTS.flatMap((c) => { const id = nodes.find((n) => n.checkpoint && n.id.includes(':') && n.title === c)?.id ?? (c === 'Review' ? byKind(wf, 'review')?.name : undefined); return id ? [[c, `/?stage=${encodeURIComponent(id)}`]] : [] }))
  const count = groups.reduce((n, g) => n + g.items.length, 0)
  return (
    <InboxAnnouncer>
      <h1 className="title">Inbox</h1>
      {(total > 0 || picked || filters.product) && <InboxFilterBar filters={filters} checkpoints={CHECKPOINTS.filter((c) => counts[c] || c === picked).map((name) => ({ name, count: counts[name] ?? 0 }))} products={products} />}
      {count ? (
        <>
          <p className="small text-muted-foreground">{count} decision{count === 1 ? '' : 's'} wait for you.</p>
          {stale && <p role="status" className="small m-0 text-muted-foreground" data-testid="stale-selection">This decision is already taken.</p>}
          <InboxView groups={groups} selected={selected?.id ?? null} detail={detail} admin={user.role === 'admin'} filters={filters} workflowHref={owner ? {} : workflowHref} products={products.length > 1} />
        </>
      ) : (
        <EmptyState {...emptyCopy({ picked, owner, working })} />
      )}
    </InboxAnnouncer>
  )
}
