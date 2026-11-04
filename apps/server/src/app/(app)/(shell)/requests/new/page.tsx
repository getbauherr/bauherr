import { IntakeChat } from '../../../components/IntakeChat'
import { EmptyState } from '../../../components/EmptyState'
import { ago } from '../../../lib/format'
import { openSessions } from '../../../lib/requests'
import { isAdmin } from '../../../lib/settings'
import { currentWorkspace, payloadClient } from '../../../lib/session'

export const dynamic = 'force-dynamic'

export default async function NewRequest({ searchParams }: { searchParams: Promise<{ session?: string }> }) {
  const { user, workspace } = await currentWorkspace()
  const payload = await payloadClient()
  const products = workspace
    ? (await payload.find({ collection: 'products', where: { workspace: { equals: workspace.id } }, sort: 'name', pagination: false, depth: 0, overrideAccess: true })).docs.map((p) => ({ id: p.id as number, name: p.name as string }))
    : []
  const wanted = (await searchParams).session
  const { open, current } = await openSessions(user.id as number, workspace?.id as number | undefined, wanted)
  const others = open.filter((s) => s !== current).map((s) => ({ id: s.id as number, product: (s.product as { name: string }).name, first: String((s.messages as { role: string; content: string }[]).find((m) => m.role === 'user')?.content ?? '').slice(0, 80), when: ago(s.updatedAt) }))
  const initial = current && { id: String(current.id), product: (current.product as { id: number }).id, lines: (current.messages as { role: string; content: string }[]).map((m) => ({ who: m.role === 'user' ? ('you' as const) : ('bauherr' as const), text: m.content })), turn: current.turn ? { ...(current.turn as object), draft: current.draft, split: current.split ?? undefined } : null }
  return (
    <>
      <h1 className="title">New request</h1>
      {products.length ? <IntakeChat userId={user.id as number} key={initial?.id} products={products} initial={initial as never} others={others} /> : <EmptyState text={`No products in ${workspace?.name ?? 'any Workspace'} yet.${isAdmin(user) ? '' : ' Ask an Admin to set up the Workspace.'}`} action={isAdmin(user) ? { href: '/setup', label: 'Set up your Workspace' } : undefined} />}
    </>
  )
}
