import type { Payload } from 'payload'

const o = { overrideAccess: true } as const

export const seedReleasesCheck = async (p: Payload): Promise<void> => {
  const known = await p.find({ collection: 'workspaces', where: { slug: { equals: 'relcheck' } }, limit: 1, ...o })
  if (known.docs.length) return
  const workspaceData = { name: 'Relcheck', slug: 'relcheck' }
  const workspace = Number((await p.create({ collection: 'workspaces', data: workspaceData, ...o })).id)
  const secret = 'e2e-dummy-secret'
  const connectionData = { name: 'GitHub Relcheck', kind: 'github', config: {}, secret, workspace } as const
  const connection = Number((await p.create({ collection: 'connections', data: connectionData, ...o })).id)
  const productData = { name: 'Unread App', slug: 'unread-app', workspace, state: 'active' }
  const product = Number((await p.create({ collection: 'products', data: productData, ...o })).id)
  const sourceData = { repo: 'relcheck/missing', product, connection, cursor: '2026-10-30T09:00:00Z', workspace }
  await p.create({ collection: 'ticket_sources', data: sourceData, ...o })
}
