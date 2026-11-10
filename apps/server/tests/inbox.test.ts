import { fileURLToPath } from 'node:url'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let fake: FakeBackend
let ws: number
let product: number
let testDb: TestDb
const o = { overrideAccess: true } as const
const repo = 'acme/web'

beforeAll(async () => {
  testDb = await createTestDb('inbox')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  process.env.BAUHERR_PACK_DIR = fileURLToPath(new URL('./fixtures/gated-pack', import.meta.url))
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws, stagingUrl: 'https://staging.example.com' }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
  await payload.create({ collection: 'bauherren', data: { email: 'a@x.io', password: 'pw-123456', role: 'admin', githubLogin: 'fake' }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const seed = async (title: string, data: Record<string, unknown>, run?: Record<string, unknown>) => {
  const issue = await fake.tickets(repo).create({ title, labels: [] })
  const t = await payload.create({ collection: 'tickets', data: { title, externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', product, workspace: ws, ...data }, ...o })
  if (run) await payload.create({ collection: 'runs', data: { ticket: t.id, mode: 'autonomous', workspace: ws, ...run }, ...o })
  return t.id as number
}
const row = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>
const sweep = async () => (await import('../src/lib/gates')).syncGates(payload)
const TLDR = { decision: 'Approve the plan', recommendation: 'Approve; it is one small file.', why: ['One file changes'], risk: 'none', options: [] }

it('the sweep writes the prepared decision with needsYou and clears both with the need', async () => {
  const id = await seed('Login redirect', { stage: 'plan', planTldr: TLDR }, { stage: 'plan', status: 'succeeded' })
  await sweep()
  let t = await row(id)
  expect(t.needsYou).toBe('Approve plan')
  expect(t.decision).toMatchObject({ need: 'Approve plan', checkpoint: 'Approve plan', recommendation: 'Approve; it is one small file.', why: ['One file changes'], preparedBy: 'agent' })
  expect(t.decision.options.map((x: { action: string }) => x.action)).toEqual(['approvePlan', 'open'])
  const since = t.decision.openSince
  await sweep()
  t = await row(id)
  expect(t.decision.openSince).toBe(since)
  await payload.update({ collection: 'tickets', id, data: { labels: ['bauherr:approved:plan'] }, ...o })
  await sweep()
  t = await row(id)
  expect(t.needsYou ?? null).toBeNull()
  expect(t.decision ?? null).toBeNull()
})

it('a decision taken in the UI sticks: the sweep does not reopen it for 2 minutes, only if it is still open after that', async () => {
  const { settleDecision } = await import('../src/lib/decision')
  const id = await seed('Export columns', { stage: 'plan', planTldr: TLDR }, { stage: 'plan', status: 'succeeded' })
  await sweep()
  expect((await row(id)).needsYou).toBe('Approve plan')
  expect(await settleDecision(payload, id)).toBe(true)
  let t = await row(id)
  expect(t.needsYou ?? null).toBeNull()
  expect(t.decision ?? null).toBeNull()
  expect(t.decidedNeed).toBe('Approve plan')
  expect(await settleDecision(payload, id)).toBe(false)
  await sweep()
  t = await row(id)
  expect(t.needsYou ?? null).toBeNull()
  expect(t.decision ?? null).toBeNull()
  await payload.update({ collection: 'tickets', id, data: { decidedAt: new Date(Date.now() - 3 * 60_000).toISOString() }, ...o })
  await sweep()
  t = await row(id)
  expect(t.needsYou).toBe('Approve plan')
  expect(t.decision.need).toBe('Approve plan')
})

it('the Inbox lists the open needsYou tickets by checkpoint, oldest first, and hides an Expedite from a member', async () => {
  const { loadInbox } = await import('../src/app/(app)/lib/inbox')
  const decision = (need: string, checkpoint: string, openSince: string) => ({ need, checkpoint, title: 't', ask: `Ask ${need}`, recommendation: null, why: [], options: [{ label: 'x', action: 'open', href: '/x', primary: true, effect: 'e' }], next: 'n', evidence: [], preparedBy: 'factory', preparedAt: openSince, openSince })
  const stage = await seed('Stage later', { stage: 'release', needsYou: 'Accept on staging', decision: decision('Accept on staging', 'Accept on staging', '2026-11-01T10:00:00Z') })
  const planNew = await seed('Plan newer', { stage: 'plan', needsYou: 'Approve plan', decision: decision('Approve plan', 'Approve plan', '2026-11-03T10:00:00Z') })
  const planOld = await seed('Plan older', { stage: 'plan', needsYou: 'Approve plan', decision: decision('Approve plan', 'Approve plan', '2026-11-02T10:00:00Z') })
  const expedite = await seed('Maybe expedite', { stage: 'triage', needsYou: 'Expedite?' })
  const closed = await seed('Closed', { stage: 'done', state: 'closed', needsYou: 'Approve plan' })
  const clean = await seed('Working', { stage: 'build' })
  const admin = await loadInbox(ws, { role: 'admin' })
  const ids = (g: typeof admin) => g.groups.flatMap((x) => x.items.map((i) => i.id))
  const order = admin.groups.map((g) => g.checkpoint)
  expect(order.indexOf('Triage')).toBeLessThan(order.indexOf('Approve plan'))
  expect(order.indexOf('Approve plan')).toBeLessThan(order.indexOf('Accept on staging'))
  expect(admin.groups.find((g) => g.checkpoint === 'Approve plan')!.items.map((i) => i.id).filter((i) => [planOld, planNew].includes(i))).toEqual([planOld, planNew])
  expect(ids(admin)).toEqual(expect.arrayContaining([stage, planNew, planOld, expedite]))
  expect(ids(admin)).not.toContain(closed)
  expect(ids(admin)).not.toContain(clean)
  expect(admin.working).toBeGreaterThan(0)
  const member = await loadInbox(ws, { role: 'bauherr' })
  expect(ids(member)).not.toContain(expedite)
  expect(ids(member)).toContain(planOld)
  const one = await loadInbox(ws, { role: 'admin' }, { checkpoint: 'Approve plan' })
  expect(one.groups.map((g) => g.checkpoint)).toEqual(['Approve plan'])
  expect(ids(one)).toEqual(expect.arrayContaining([planOld, planNew]))
  expect(ids(one)).not.toContain(stage)
  const other = await loadInbox(ws, { role: 'admin' }, { product: product + 99 })
  expect(other.groups).toEqual([])
})

it('builds the card from the row when the sweep has not written a decision yet', async () => {
  const { loadInbox } = await import('../src/app/(app)/lib/inbox')
  const id = await seed('Fresh cap', { stage: 'review', reviewState: 'needs_human', reviewRounds: 3, needsYou: 'Round cap reached' })
  const { groups } = await loadInbox(ws, { role: 'admin' })
  const card = groups.flatMap((g) => g.items).find((i) => i.id === id)!
  expect(card.decision.need).toBe('Round cap reached')
  expect(card.decision.options.map((x) => x.action)).toEqual(['grantRound', 'stopReview'])
})
