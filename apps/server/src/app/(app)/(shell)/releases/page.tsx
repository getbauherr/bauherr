import { EmptyState } from '../../components/EmptyState'
import { ReleasePanel } from '../../components/ReleasePanel'
import { Tab, Tabs } from '../../components/ui/tabs'
import { renderMarkdown } from '../../lib/markdown'
import { isAdmin } from '../../lib/settings'
import { currentWorkspace, payloadClient } from '../../lib/session'
import { isFix } from '../../../../lib/release-notes'
import { releaseDraft } from '../../../../lib/ship-release'

const kindOf = (t: Record<string, any>) => { const l: string[] = t.labels ?? []; return l.includes('breaking') ? 'Breaking' : l.includes('type:feature') ? 'Feature' : isFix(t.title, l) ? 'Fix' : 'Other' }

export const dynamic = 'force-dynamic'

export default async function Releases({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const { user, workspace } = await currentWorkspace()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const payload = await payloadClient()
  const products = (await payload.find({ collection: 'products', where: { workspace: { equals: workspace.id } }, sort: 'name', pagination: false, depth: 0, overrideAccess: true })).docs as unknown as { id: number; name: string }[]
  if (!products.length) return <EmptyState text="No Products yet." action={{ href: '/setup', label: 'Set up your Workspace' }} />
  const wanted = (await searchParams).product
  const product = products.find((p) => String(p.id) === wanted) ?? products[0]!
  let draft: Awaited<ReturnType<typeof releaseDraft>> | null = null
  try {
    draft = await releaseDraft(payload, product.id)
  } catch (e) {
    console.warn('releases: forge unavailable', e)
  }
  return (
    <>
      <h1 className="title">Releases</h1>
      {products.length > 1 && (
        <Tabs aria-label="Product">
          {products.map((p) => <Tab key={p.id} href={`/releases?product=${p.id}`} aria-current={p.id === product.id ? 'page' : undefined}>{p.name}</Tab>)}
        </Tabs>
      )}
      {draft ? (
        <ReleasePanel
          key={`${product.id}:${draft.waiting.map((t) => t.id).join(',')}`}
          product={product.id}
          admin={isAdmin(user)}
          tickets={draft.waiting.map((t) => ({ id: t.id as number, number: t.number as number, title: t.title as string, kind: kindOf(t) }))}
          version={draft.version}
          versions={draft.versions}
          notes={draft.notes}
          past={draft.past.map((r) => ({ tag: r.tag, url: r.url, at: r.createdAt ?? null, html: renderMarkdown(r.body.replace(/<!--[\s\S]*?-->/g, '').trim()) }))}
        />
      ) : (
        <EmptyState text={`${product.name} has no repository connected, or the forge could not be reached.`} action={{ href: '/settings/products', label: 'Open Product settings' }} />
      )}
    </>
  )
}
