import type { Payload } from 'payload'
import { Suspense } from 'react'
import { EmptyState } from '../../components/EmptyState'
import { ReleasePanel } from '../../components/ReleasePanel'
import { Tab, Tabs } from '../../components/ui/tabs'
import { renderMarkdown } from '../../lib/markdown'
import { within } from '../../lib/overview'
import { isAdmin } from '../../lib/settings'
import { currentWorkspace, payloadClient } from '../../lib/session'
import { isFix } from '../../../../lib/release-notes'
import { releaseDraft } from '../../../../lib/ship-release'

const kindOf = (t: Record<string, any>) => { const l: string[] = t.labels ?? []; return l.includes('breaking') ? 'Breaking' : l.includes('type:feature') ? 'Feature' : isFix(t.title, l) ? 'Fix' : 'Other' }

export const dynamic = 'force-dynamic'

const RELEASES_MS = 8000

export default async function Releases({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const { user, workspace } = await currentWorkspace()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const payload = await payloadClient()
  const products = (await payload.find({ collection: 'products', where: { workspace: { equals: workspace.id } }, sort: 'name', pagination: false, depth: 0, overrideAccess: true })).docs as unknown as { id: number; name: string }[]
  if (!products.length) return <EmptyState text="No Products yet." action={{ href: '/setup', label: 'Set up your Workspace' }} />
  const wanted = (await searchParams).product
  const product = products.find((p) => String(p.id) === wanted) ?? products[0]!
  return (
    <>
      <h1 className="title">Releases</h1>
      {products.length > 1 && (
        <Tabs aria-label="Product">
          {products.map((p) => <Tab key={p.id} href={`/releases?product=${p.id}`} aria-current={p.id === product.id ? 'page' : undefined}>{p.name}</Tab>)}
        </Tabs>
      )}
      <Suspense key={product.id} fallback={<div className="flex flex-col gap-4" aria-busy="true"><div className="h-6 w-1/3 animate-pulse rounded-sm bg-secondary" /><div className="h-40 animate-pulse rounded-sm bg-secondary" /></div>}>
        <Draft payload={payload} product={product} admin={isAdmin(user)} />
      </Suspense>
    </>
  )
}

/** The forge-backed part (release list, ancestry, Ticket comments for the notes), streamed after the shell; 8 s, then the empty state. */
async function Draft({ payload, product, admin }: { payload: Payload; product: { id: number; name: string }; admin: boolean }) {
  const draft = await within(releaseDraft(payload, product.id), RELEASES_MS).catch((e) => {
    console.warn('releases: forge unavailable', e)
    return null
  })
  return draft ? (
    <ReleasePanel
      key={`${product.id}:${draft.waiting.map((t) => t.id).join(',')}`}
      product={product.id}
      admin={admin}
      tickets={draft.waiting.map((t) => ({ id: t.id as number, number: t.number as number, title: t.title as string, kind: kindOf(t) }))}
      version={draft.version}
      versions={draft.versions}
      notes={draft.notes}
      past={draft.past.map((r) => ({ tag: r.tag, url: r.url, at: r.createdAt ?? null, html: renderMarkdown(r.body.replace(/<!--[\s\S]*?-->/g, '').trim()) }))}
    />
  ) : (
    <EmptyState text={`${product.name} has no repository connected, or the forge could not be reached.`} action={{ href: '/settings/products', label: 'Open Product settings' }} />
  )
}
