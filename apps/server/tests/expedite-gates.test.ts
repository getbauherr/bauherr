import { fileURLToPath } from 'node:url'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let fake: FakeBackend
let ws: number
let product: number
let gates: typeof import('../src/lib/gates')
let release: typeof import('../src/lib/release')
const o = { overrideAccess: true } as const
const repo = 'acme/web'

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('expedite_373')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  process.env.BAUHERR_PACK_DIR = fileURLToPath(new URL('./fixtures/gated-pack', import.meta.url))
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  gates = await import('../src/lib/gates')
  release = await import('../src/lib/release')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
  await payload.create({ collection: 'bauherren', data: { email: 'a@x.io', password: 'pw-123456', role: 'admin', githubLogin: 'fake' }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

beforeEach(async () => {
  await payload.update({ collection: 'products', id: product, data: { expediteSkipStaging: false }, ...o })
})

const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>
const gateComments = async (n: string) => (await fake.tickets(repo).listComments(n)).filter((c) => c.body.startsWith('<!-- bauherr:gate:'))

/** A merged Ticket in release, its merge commit green on staging. */
const releaseTicket = async (title: string, expedite: boolean) => {
  const issue = await fake.tickets(repo).create({ title, labels: ['bauherr:stage:release'] })
  const t = await payload.create({ collection: 'tickets', data: { title, externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage: 'release', product, workspace: ws, mergeSha: `sha-${issue.number}`, releaseAt: new Date().toISOString(), releaseState: 'on_staging', expedite }, ...o })
  fake.setChecks(repo, `sha-${issue.number}`, [{ name: 'ci', status: 'completed', conclusion: 'success' }])
  return { id: t.id as number, n: String(issue.number) }
}

it('notifies a Hotfix gate marked "Hotfix", and expediteOnly leaves other Tickets for the sweep', async () => {
  const hot = await releaseTicket('hot', true)
  const normal = await releaseTicket('normal', false)
  expect(await gates.syncGates(payload, true)).toBe(1)
  const [c] = await gateComments(hot.n)
  expect(c.body).toMatch(/\n@fake: Hotfix, Accept on staging — /)
  expect(await gateComments(normal.n)).toHaveLength(0)
  await gates.syncGates(payload)
  expect((await gateComments(normal.n))[0].body).toMatch(/\n@fake: Accept on staging — /)
  expect(await gateComments(hot.n)).toHaveLength(1)
})

it('skips the staging gate for a Hotfix only when the Product opted in, and records the staging touch', async () => {
  const off = await releaseTicket('off', true)
  await release.watchRelease(payload)
  expect(await reload(off.id)).toMatchObject({ stage: 'release', releaseState: 'on_staging', productionState: null })

  await payload.update({ collection: 'products', id: product, data: { expediteSkipStaging: true, productionGate: true, productionChecks: 'deploy-prod' }, ...o })
  const normal = await releaseTicket('normal', false)
  const hot = await releaseTicket('hot', true)
  await release.watchRelease(payload)
  expect(await reload(normal.id)).toMatchObject({ productionState: null })
  expect(await reload(hot.id)).toMatchObject({ stage: 'release', productionState: 'awaiting_approval' })
  expect(await reload(off.id)).toMatchObject({ productionState: 'awaiting_approval' })
  expect((await fake.tickets(repo).get(hot.n)).labels).toContain('bauherr:approved:staging')
  expect((await payload.count({ collection: 'human_touches', where: { and: [{ ticket: { equals: hot.id } }, { kind: { equals: 'auto:staging' } }] }, ...o })).totalDocs).toBe(1)
})
