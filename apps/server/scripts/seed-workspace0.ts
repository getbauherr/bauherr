import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getPayload } from 'payload'
import { parse } from 'yaml'
import config from '../src/payload.config'

const env = (k: string): string => {
  const v = process.env[k]
  if (!v) throw new Error(`missing env ${k}`)
  return v
}

const payload = await getPayload({ config })
const o = { overrideAccess: true } as const

/** Find by `where` or create. */
const ensure = async (collection: string, where: Record<string, unknown>, data: Record<string, unknown>) => {
  const found = await payload.find({ collection, where: where as never, limit: 1, depth: 0, ...o })
  return found.docs[0] ?? (await payload.create({ collection, data: data as never, ...o }))
}
const eq = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { equals: v }]))

await ensure('bauherren', eq({ email: env('BAUHERR_ADMIN_EMAIL') }), {
  email: env('BAUHERR_ADMIN_EMAIL'),
  password: env('BAUHERR_ADMIN_PASSWORD'),
  role: 'admin',
})

const ws = await ensure('workspaces', eq({ slug: 'getbauherr' }), { name: 'getbauherr', slug: 'getbauherr' })
const workspace = ws.id
const scoped = (c: string, key: Record<string, unknown>, data: Record<string, unknown>) =>
  ensure(c, eq({ workspace, ...key }), { workspace, ...key, ...data })

const github = await scoped('connections', { name: 'github' }, {
  kind: 'github',
  config: {},
  secret: env('GITHUB_TOKEN'),
  capabilities: { attachments: false, nativeSubTickets: true, nativeBlocking: true, webhooks: false },
})
await scoped('connections', { name: 'gateway' }, { kind: 'gateway', config: { url: env('GATEWAY_URL') }, secret: env('GATEWAY_KEY') })
const product = await scoped('products', { slug: 'bauherr' }, { name: 'bauherr' })
await scoped('repositories', { fullName: 'getbauherr/bauherr' }, { product: product.id })
await scoped('ticket_sources', { repo: 'getbauherr/bauherr', product: product.id }, { connection: github.id })
const compiled = parse(readFileSync(fileURLToPath(new URL('../../../pack/workflow.yaml', import.meta.url)), 'utf8'))
await scoped('workflow_versions', { product: product.id, version: 1 }, { compiled })

payload.logger.info(`seeded workspace ${workspace}`)
process.exit(0)
