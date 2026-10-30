import { readFileSync } from 'node:fs'
import { getPayload } from 'payload'
import config from '../src/payload.config'

/** Seeds what the Playwright smoke needs on an empty DB: one admin, one Workspace, one Product, one Ticket. Idempotent. */
const env = (k: string): string => {
  const v = process.env[k]
  if (!v) throw new Error(`missing env ${k}`)
  return v
}
const payload = await getPayload({ config })
const o = { overrideAccess: true } as const
const ensure = async (collection: string, where: Record<string, unknown>, data: Record<string, unknown>) => {
  const found = await payload.find({ collection, where: Object.fromEntries(Object.entries(where).map(([k, v]) => [k, { equals: v }])) as never, limit: 1, depth: 0, ...o })
  return found.docs[0] ?? (await payload.create({ collection, data: data as never, ...o }))
}

const email = env('E2E_EMAIL')
await ensure('bauherren', { email }, { email, password: readFileSync(env('E2E_PASSWORD_FILE'), 'utf8').trim(), role: 'admin' })
const workspace = (await ensure('workspaces', { slug: 'acme' }, { name: 'Acme', slug: 'acme' })).id
const product = (await ensure('products', { slug: 'acme-web' }, { name: 'Acme Web', slug: 'acme-web', workspace })).id
await ensure('tickets', { externalId: 'e2e-1' }, {
  title: 'Add a dark theme to the dashboard', externalId: 'e2e-1', number: 1, url: 'https://github.com/acme/web/issues/1',
  state: 'open', labels: ['bauherr:stage:plan'], stage: 'plan', product, workspace,
})
console.log('seeded')
process.exit(0)
