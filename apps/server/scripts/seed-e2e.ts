import { readFileSync } from 'node:fs'
import { getPayload } from 'payload'
import config from '../src/payload.config'
import { LIVE_RUN_INDEX } from '../src/migrations/20261119_140000_stage_runs'
import { readRecord } from '../src/core/record/store'
import { coreDbOn } from '../tests/core/db'
import { engineOn } from '../tests/core/harness'
import { begin, seedScenario, type ScenarioNames } from '../tests/core/scenario'
import { seedMockupTicket } from '../tests/core/mockup-scenario'
import { seedTickets } from '../tests/core/ticket-scenario'
import { seedConnect } from './seed-connect'
import { seedBoardRelations } from './seed-board-relations'
import { seedSomeday } from './seed-someday'
import { seedReadiness } from './seed-readiness'
import { seedRequestList } from './seed-requests-list'
import { seedInsights } from './seed-insights'
import { seedMemoryEditor } from './seed-memory-editor'
import { seedRetro } from './seed-retro'
import { seedRequests } from './seed-requests'
import { seedHandover } from './seed-handover'

const env = (k: string): string => {
  const v = process.env[k]
  if (!v) throw new Error(`missing env ${k}`)
  return v
}
const payload = await getPayload({ config })
const o = { overrideAccess: true } as const
const ensure = async (collection: string, where: Record<string, unknown>, data: Record<string, unknown>) => {
  const found = await payload.find({
    collection,
    where: Object.fromEntries(Object.entries(where).map(([k, v]) => [k, { equals: v }])),
    limit: 1,
    depth: 0,
    ...o,
  })
  return found.docs[0] ?? (await payload.create({ collection, data, ...o }))
}

const FACTORY_TITLES: Record<keyof ScenarioNames, string> = {
  intakeQueued: 'Queued for triage',
  intakeWorking: 'Triage in progress',
  reporterAsked: 'PDF report shows wrong year',
  failedRuns: 'Import skips empty rows',
  reporterSilent: 'Reporter went silent',
  briefQueued: 'Brief being drafted',
  briefCard: 'Export fails for large files',
  building: 'Rename report columns',
  verifyRounds: 'Tag filter keeps failing',
  waitingChecks: 'Speed up measure search',
  reviewing: 'Review of the export patch',
  verifying: 'Review of the date filter',
  resultCard: 'Add target-year check',
  accepted: 'Fix date format',
  closed: 'Login broken on Safari',
  parked: 'Parked behind the Brief limit',
}

const email = env('E2E_EMAIL')
const password = readFileSync(env('E2E_PASSWORD_FILE'), 'utf8').trim()
const user = (address: string, role: string, extra: Record<string, unknown> = {}) =>
  ensure('bauherren', { email: address }, { email: address, password, role, ...extra })

await user(email, 'admin')
for (const w of [1, 2]) await user(email.replace('@', `-w${w}@`), 'admin')
await user('signout-shell@example.com', 'admin')

const workspace = (await ensure('workspaces', { slug: 'acme' }, { name: 'Acme', slug: 'acme' })).id
const zeta = (await ensure('workspaces', { slug: 'zeta' }, { name: 'Zeta', slug: 'zeta' })).id
const settingsco = (await ensure('workspaces', { slug: 'settingsco' }, { name: 'Settingsco', slug: 'settingsco' })).id

await user('member@example.com', 'bauherr', { tenants: [{ tenant: workspace }] })
await user('guard-bauherr@example.com', 'bauherr', { tenants: [{ tenant: workspace }] })
await user('members-edit@example.com', 'bauherr', { tenants: [{ tenant: workspace }] })
await user('solo@example.com', 'bauherr', { tenants: [{ tenant: zeta }] })
await user('duo@example.com', 'bauherr', { tenants: [{ tenant: workspace }, { tenant: zeta }] })

const github = (
  await ensure(
    'connections',
    { name: 'GitHub Acme' },
    { name: 'GitHub Acme', kind: 'github', config: {}, secret: 'e2e-dummy-secret', workspace },
  )
).id
const product = (
  await ensure(
    'products',
    { slug: 'acme-web' },
    { name: 'Acme Web', slug: 'acme-web', workspace, stagingUrl: 'https://staging.example.com' },
  )
).id
await ensure('products', { slug: 'acme-shop' }, { name: 'Acme Shop', slug: 'acme-shop', workspace })
await ensure('products', { slug: 'zeta-app' }, { name: 'Zeta App', slug: 'zeta-app', workspace: zeta })
await ensure('repositories', { fullName: 'acme/web' }, { fullName: 'acme/web', product, workspace })
await ensure(
  'ticket_sources',
  { repo: 'acme/web' },
  { repo: 'acme/web', product, connection: github, cursor: '2026-10-30T09:00:00Z', workspace },
)
const checksProduct = (
  await ensure('products', { slug: 'acme-checks' }, { name: 'Acme Checks', slug: 'acme-checks', workspace })
).id
await ensure(
  'repositories',
  { fullName: 'acme/checks' },
  { fullName: 'acme/checks', product: checksProduct, workspace },
)
await ensure(
  'ticket_sources',
  { repo: 'acme/checks' },
  { repo: 'acme/checks', product: checksProduct, connection: github, cursor: '2026-10-30T09:00:00Z', workspace },
)
await user('owner@example.com', 'product-owner', {
  assignments: [{ workspace, scope: 'products', products: [product] }],
})
await ensure('products', { slug: 'acme-bare' }, { name: 'Acme Bare', slug: 'acme-bare', workspace })

await ensure(
  'connections',
  { name: 'GitHub Settingsco' },
  { name: 'GitHub Settingsco', kind: 'github', config: {}, secret: 'e2e-dummy-secret', workspace: settingsco },
)
const settingsApp = (
  await ensure(
    'products',
    { slug: 'settingsco-app' },
    { name: 'Settings App', slug: 'settingsco-app', workspace: settingsco, stagingUrl: 'https://staging.example.com' },
  )
).id
await ensure(
  'repositories',
  { fullName: 'settingsco/app' },
  { fullName: 'settingsco/app', product: settingsApp, workspace: settingsco },
)

const hooksWs = (await ensure('workspaces', { slug: 'hooks' }, { name: 'Hooks', slug: 'hooks' })).id
const forgeConnection = { secret: 'e2e-dummy-secret', workspace: hooksWs }
const githubHooks = { ...forgeConnection, name: 'GitHub Hooks', kind: 'github', config: {} }
await ensure('connections', { name: 'GitHub Hooks' }, githubHooks)
await ensure(
  'connections',
  { name: 'GitLab Delivered' },
  {
    ...forgeConnection,
    name: 'GitLab Delivered',
    kind: 'gitlab',
    config: { baseUrl: 'https://gitlab.com' },
    webhookSecret: 'e2e-literal-hook-secret',
    webhookDeliveredAt: '2026-11-19T10:00:00Z',
  },
)

const factory = Number((await ensure('workspaces', { slug: 'factory' }, { name: 'Factory', slug: 'factory' })).id)
const factoryProduct = { name: 'Factory App', slug: 'factory-app', workspace: factory, state: 'active' }
const factoryApp = Number((await ensure('products', { slug: 'factory-app' }, factoryProduct)).id)
await user('po-factory@example.com', 'product-owner', {
  assignments: [{ workspace: factory, scope: 'products', products: [factoryApp] }],
})
await user('po-none@example.com', 'product-owner')
await user('po-oidc@example.com', 'product-owner', {
  oidcSubject: 'http://localhost:4010|po-oidc',
  assignments: [{ workspace: factory, scope: 'products', products: [factoryApp] }],
})
const inFactory = { workspace: { equals: factory } }
const seeded = await payload.find({ collection: 'records', where: inFactory, limit: 1, depth: 0, ...o })
if (!seeded.docs.length) {
  await payload.db.drizzle.execute(LIVE_RUN_INDEX)
  const ids = { workspace: factory, otherWorkspace: Number(workspace), product: factoryApp }
  const engine = engineOn(
    coreDbOn(payload, ids, async () => {}),
    undefined,
    new Date(),
  )
  const scenario = await seedScenario(engine, (name) => FACTORY_TITLES[name])
  for (const title of ['Reorder first', 'Reorder second']) {
    const { record } = await readRecord(payload, await begin(engine))
    await scenario.item(record.source.number, { title })
  }
}

const ticketsWs = Number((await ensure('workspaces', { slug: 'tickets' }, { name: 'Tickets', slug: 'tickets' })).id)
await user('run-member@example.com', 'bauherr', { tenants: [{ tenant: ticketsWs }] })
const ticketsApp = { name: 'Tickets App', slug: 'tickets-app', workspace: ticketsWs, state: 'active' }
const ticketsProduct = Number((await ensure('products', { slug: 'tickets-app' }, ticketsApp)).id)
const inTickets = { workspace: { equals: ticketsWs } }
const ticketsSeeded = await payload.find({ collection: 'records', where: inTickets, limit: 1, depth: 0, ...o })
if (!ticketsSeeded.docs.length) {
  const ids = { workspace: ticketsWs, otherWorkspace: Number(workspace), product: ticketsProduct }
  const ticketsEngine = engineOn(
    coreDbOn(payload, ids, async () => {}),
    undefined,
    new Date(),
  )
  await seedTickets(ticketsEngine)
  await seedMockupTicket(ticketsEngine)
}
await seedRequestList(payload, user)
await seedConnect(payload)
await seedSomeday(payload)
await seedBoardRelations(payload)
await seedMemoryEditor(payload, (address, tenant) => user(address, 'bauherr', { tenants: [{ tenant }] }))
await seedReadiness(payload)
await seedRequests(payload)
await seedHandover(payload, user)
await seedInsights(payload)
await seedRetro(payload, (address, tenant) => user(address, 'bauherr', { tenants: [{ tenant }] }))

await ensure(
  'human_touches',
  { kind: 'e2e:audit' },
  { kind: 'e2e:audit', actor: 'e2e-audit-actor', at: '2026-10-30T09:00:00Z', workspace },
)

console.log('seeded')
process.exit(0)
