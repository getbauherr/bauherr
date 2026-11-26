import type { Payload } from 'payload'
import { readRecord } from '../src/core/record/store'
import { coreDbOn } from '../tests/core/db'
import { engineOn } from '../tests/core/harness'
import { begin, mirrorSource } from '../tests/core/scenario'

const o = { overrideAccess: true } as const

export const seedHandover = async (
  p: Payload,
  user: (address: string, role: string, extra?: Record<string, unknown>) => Promise<unknown>,
): Promise<void> => {
  const known = await p.find({ collection: 'workspaces', where: { slug: { equals: 'handover' } }, limit: 1, ...o })
  if (known.docs.length) return
  const named = { name: 'Handover', slug: 'handover' }
  const workspace = Number((await p.create({ collection: 'workspaces', data: named, ...o })).id)
  const data = { name: 'Handover App', slug: 'handover-app', workspace, state: 'active' }
  const product = Number((await p.create({ collection: 'products', data, ...o })).id)
  await user('po-handover@example.com', 'product-owner', {
    assignments: [{ workspace, scope: 'products', products: [product] }],
  })
  const ids = { workspace, otherWorkspace: workspace, product }
  const engine = engineOn(coreDbOn(p, ids, async () => {}), undefined, new Date())
  const mirror = await mirrorSource(engine)
  const { record } = await readRecord(p, await begin(engine))
  await mirror.item(record.source.number, { title: 'Rename the handover column' })
}
