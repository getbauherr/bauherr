import { activeVersion } from '../../../lib/factory'
import { loadConnections } from './settings'
import { payloadClient } from './session'
import { SKIP_SESSION, stepsOf, type SetupFacts } from './setup-steps'

export * from './setup-steps'

type Doc = Record<string, any>
const o = { depth: 0, overrideAccess: true, pagination: false } as const

/** Database-only facts of a Workspace's setup, a handful of small queries: the page and the sidebar chip both use it. */
export async function loadSetup(workspace: number) {
  const payload = await payloadClient()
  const where = { workspace: { equals: workspace } }
  const find = async (collection: string, extra: object) => (await payload.find({ collection, where, ...o, ...extra } as never)).docs as unknown as Doc[]
  const count = async (collection: string, w: object) => (await payload.count({ collection, where: w, overrideAccess: true } as never)).totalDocs
  const [connections, products, repositories, sources, sessions, skips, version] = await Promise.all([
    loadConnections(workspace),
    find('products', { select: { name: true } }),
    find('repositories', { select: { product: true } }),
    find('ticket_sources', { select: { product: true } }),
    count('agent_sessions', where),
    count('human_touches', { and: [where, { kind: { equals: SKIP_SESSION } }] }),
    activeVersion(payload, workspace),
  ])
  const ref = (v: unknown) => (v && typeof v === 'object' ? (v as Doc).id : v)
  const ready = products.find((p) => repositories.some((r) => ref(r.product) === p.id) && sources.some((s) => ref(s.product) === p.id))
  const requested = ready ? (await count('tickets', { product: { equals: ready.id } })) + (await count('intake_sessions', { and: [{ product: { equals: ready.id } }, { status: { equals: 'submitted' } }] })) > 0 : false
  const forges = connections.filter((c) => c.kind === 'github' || c.kind === 'gitlab')
  const facts: SetupFacts = {
    forgeConnected: forges.some((c) => c.status === 'ok' || c.inUse),
    product: !!ready,
    teamApplied: !!version,
    sessionEver: sessions > 0,
    llmConnection: connections.some((c) => c.kind === 'llm-provider'),
    sessionSkipped: skips > 0,
    ticket: requested,
  }
  return { facts, ...stepsOf(facts), connections, forges, product: ready ? { id: ready.id as number, name: ready.name as string } : undefined, products: products.length }
}
