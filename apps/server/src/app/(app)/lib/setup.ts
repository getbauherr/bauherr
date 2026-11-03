import { loadConnections, loadProducts } from './settings'
import { payloadClient } from './session'

export const SETUP_STEPS = [
  ['connect', 'Connect GitHub'],
  ['product', 'Add the first Product'],
  ['deploy', 'Staging and gates'],
  ['request', 'First request'],
] as const
export type SetupStepId = (typeof SETUP_STEPS)[number][0]

/** Where the Workspace stands on /setup, computed from existing data: a verified GitHub Connection, the first Product with repository and ticket source, a saved or skipped staging/gates form (staging site set, or the Product saved at least a second after it was created), a Ticket or submitted request of that Product. */
export async function loadSetup(workspace: number) {
  const [connections, { products, connections: forges }] = await Promise.all([loadConnections(workspace), loadProducts(workspace)])
  const github = connections.filter((c) => c.kind === 'github')
  const product = products.find((p) => p.repositories.length && p.sources.length)
  const payload = await payloadClient()
  const count = async (collection: string, where: object) => (await payload.count({ collection, where, overrideAccess: true } as never)).totalDocs
  const requested = !!product && (await count('tickets', { product: { equals: product.id } })) + (await count('intake_sessions', { product: { equals: product.id }, status: { equals: 'submitted' } })) > 0
  const done: Record<SetupStepId, boolean> = { connect: github.some((c) => c.status === 'ok'), product: !!product, deploy: !!product && (!!product.deploy.stagingUrl || product.touched), request: requested }
  const steps = SETUP_STEPS.map(([id, label]) => ({ id, label, done: done[id] }))
  return { steps, current: steps.find((s) => !s.done)?.id, github, forges, product }
}
