import type { Payload } from 'payload'

const o = { overrideAccess: true } as const

const make = async (p: Payload, collection: 'workspaces' | 'connections' | 'products', data: object): Promise<number> =>
  Number((await p.create({ collection, data, ...o })).id)

export const seedRequests = async (p: Payload): Promise<void> => {
  const known = await p.find({ collection: 'workspaces', where: { slug: { equals: 'requests' } }, limit: 1, ...o })
  if (known.docs.length) return
  const workspace = await make(p, 'workspaces', { name: 'Requests', slug: 'requests' })
  const secret = 'e2e-dummy-secret'
  const connection = await make(p, 'connections', {
    name: 'GitHub Requests',
    kind: 'github',
    config: {},
    secret,
    workspace,
  })
  const product = await make(p, 'products', { name: 'Requests App', slug: 'requests-app', workspace, state: 'active' })
  const sourceData = { repo: 'requests/app', product, connection, cursor: '2026-10-30T09:00:00Z', workspace }
  await p.create({ collection: 'ticket_sources', data: sourceData, ...o })
}
