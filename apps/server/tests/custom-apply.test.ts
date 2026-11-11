import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

/** The custom pack applied to ONE Workspace of a default-pack instance: its Tickets go through the security stage, the other Workspace's do not. */
let payload: Payload
let fake: FakeBackend
let actions: typeof import('../src/lib/actions')
let member: Record<string, any>
const o = { overrideAccess: true } as const
const packDir = fileURLToPath(new URL('./fixtures/custom-pack', import.meta.url))

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('custom_apply')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  actions = await import('../src/lib/actions')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const workspace = async (slug: string, repo: string) => {
  const ws = (await payload.create({ collection: 'workspaces', data: { name: slug, slug, defaultMode: 'session' }, ...o })).id as number
  const product = (await payload.create({ collection: 'products', data: { name: slug, slug, workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
  return { ws, product, repo }
}
const buildTicket = async ({ ws, product, repo }: { ws: number; product: number; repo: string }) => {
  const issue = await fake.tickets(repo).create({ title: 't', labels: ['bauherr:stage:build'] })
  const t = (await payload.create({ collection: 'tickets', data: { title: 't', externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage: 'build', product, workspace: ws }, ...o })).id as number
  const head = `bauherr/${issue.number}-x`
  await fake.forge.createBranch(repo, head)
  const pr = await fake.forge.openPullRequest(repo, { title: 't', body: 'x\n\n## Evidence\n| Goal | verified |\n', head, base: 'main' })
  fake.setChecks(repo, pr.headSha, [{ name: 'ci', status: 'completed', conclusion: 'success' }])
  return t
}

it('applying the custom file to one Workspace gives only its Tickets the security stage', async () => {
  member = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'admin' }, ...o })
  const a = await workspace('plain', 'plain/web')
  const b = await workspace('secure', 'secure/web')
  const { applyFactory, workflowFor } = await import('../src/lib/factory')
  const yaml = readFileSync(`${packDir}/factory.yaml`, 'utf8')
  expect(await applyFactory(payload, b.ws, yaml, { by: 'm@x.io', via: 'api' })).toMatchObject({ ok: false, findings: [expect.stringMatching(/skill "security-review"/)] })
  process.env.BAUHERR_PACK_DIR = packDir
  try {
    expect(await applyFactory(payload, b.ws, yaml, { by: 'm@x.io', via: 'api' })).toMatchObject({ ok: true, version: 1 })
  } finally {
    delete process.env.BAUHERR_PACK_DIR
  }
  expect(workflowFor(a.ws).stages.map((s) => s.name)).not.toContain('security')
  expect(workflowFor(b.ws).stages.map((s) => [s.name, s.kind]).filter(([n]) => n === 'security' || n === 'signoff')).toEqual([['security', 'agent'], ['signoff', 'human']])
  expect(await actions.requestReview(payload, member, { ticket: await buildTicket(a), evidence: '' })).toEqual({ stage: 'review' })
  const secured = await buildTicket(b)
  expect(await actions.requestReview(payload, member, { ticket: secured, evidence: '' })).toEqual({ stage: 'security' })
  expect(((await payload.find({ collection: 'runs', where: { ticket: { equals: secured } }, depth: 0, ...o })).docs[0] as Record<string, any>)).toMatchObject({ stage: 'security', kind: 'agent' })
})
