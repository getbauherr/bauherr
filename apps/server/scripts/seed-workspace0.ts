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

const anthropicKey = process.env.ANTHROPIC_API_KEY_FILE ? readFileSync(process.env.ANTHROPIC_API_KEY_FILE, 'utf8').trim() : env('ANTHROPIC_API_KEY')

const payload = await getPayload({ config })
const o = { overrideAccess: true } as const

/** Find by `where` or create. */
const ensure = async (collection: string, where: Record<string, unknown>, data: Record<string, unknown>) => {
  const found = await payload.find({ collection, where: where as never, limit: 1, depth: 0, ...o })
  return found.docs[0] ?? (await payload.create({ collection, data: data as never, ...o }))
}
const eq = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { equals: v }]))

const adminPassword = process.env.BAUHERR_ADMIN_PASSWORD_FILE ? readFileSync(process.env.BAUHERR_ADMIN_PASSWORD_FILE, 'utf8').trim() : env('BAUHERR_ADMIN_PASSWORD')
const admin = await ensure('bauherren', eq({ email: env('BAUHERR_ADMIN_EMAIL') }), {
  email: env('BAUHERR_ADMIN_EMAIL'),
  password: adminPassword,
  role: 'admin',
})
// ensure() never touches an existing user; re-seeding is how the password is reset.
await payload.update({ collection: 'bauherren', id: admin.id, data: { password: adminPassword, role: 'admin' }, ...o })

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
await scoped('connections', { name: 'anthropic' }, { kind: 'llm-provider', config: { provider: 'anthropic' }, secret: anthropicKey })
const product = await scoped('products', { slug: 'bauherr' }, { name: 'bauherr' })
await scoped('repositories', { fullName: 'getbauherr/bauherr' }, { product: product.id })
await scoped('ticket_sources', { repo: 'getbauherr/bauherr', product: product.id }, { connection: github.id })
const compiled = parse(readFileSync(fileURLToPath(new URL('../../../pack/workflow.yaml', import.meta.url)), 'utf8'))
await scoped('workflow_versions', { product: product.id, version: 1 }, { compiled })

const smoke = process.env.BAUHERR_SMOKE_REPO
if (smoke) {
  const sandbox = await scoped('products', { slug: 'sandbox' }, { name: 'sandbox' })
  await scoped('repositories', { fullName: smoke }, { product: sandbox.id })
  await scoped('ticket_sources', { repo: smoke, product: sandbox.id }, { connection: github.id })
  await scoped('workflow_versions', { product: sandbox.id, version: 1 }, { compiled })
}

payload.logger.info(`seeded workspace ${workspace}`)
process.exit(0)
