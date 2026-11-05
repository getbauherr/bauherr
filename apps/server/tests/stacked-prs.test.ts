import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { claimOnly } from './helpers/claim'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let fake: FakeBackend
let member: Record<string, any>
let product: number
let ws: number
let actions: typeof import('../src/lib/actions')
let release: typeof import('../src/lib/release')
let call: (user: Record<string, any>, name: string, input: unknown) => Promise<any>
const o = { overrideAccess: true } as const
const repo = 'acme/web'
const EVIDENCE = 'x\n\n## Evidence\n| Goal | verified |\n'
const green = [{ name: 'ci', status: 'completed', conclusion: 'success' }]

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('stacked_prs')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  actions = await import('../src/lib/actions')
  release = await import('../src/lib/release')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  const { callTool } = await import('../src/lib/mcp-tools')
  call = (user, name, input) => callTool({ payload, user, actor: { kind: 'human' } }, name, input)
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'session' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
  member = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>
const openPr = async (number: number, suffix: string, base = 'main') => {
  const branch = `bauherr/${number}-${suffix}`
  await fake.forge.createBranch(repo, branch)
  fake.commit(repo, branch, `${suffix}.ts`, suffix)
  return fake.forge.openPullRequest(repo, { title: suffix, body: EVIDENCE, head: branch, base })
}
/** A Ticket in `stage` whose newest Build Run links `linked` (an MR of the fake forge). */
const seed = async (stage: string, linked?: { url: string }) => {
  const issue = await fake.tickets(repo).create({ title: `t ${stage}`, labels: [`bauherr:stage:${stage}`] })
  const t = await payload.create({ collection: 'tickets', data: { title: 'x', externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage, product, workspace: ws }, ...o })
  if (linked) await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'build', status: 'succeeded', mode: 'session', workspace: ws, artifacts: { prUrl: linked.url } }, ...o })
  return { t, id: t.id as number, number: issue.number as number }
}

it('a stacked child stays open and is retargeted to main when its base MR is merged by the gate', async () => {
  const { t, id, number } = await seed('review')
  const base = await openPr(number, 'base')
  await payload.create({ collection: 'runs', data: { ticket: id, stage: 'build', status: 'succeeded', mode: 'session', workspace: ws, artifacts: { prUrl: base.url } }, ...o })
  await fake.forge.createBranch(repo, 'stack/child', base.head)
  const child = await fake.forge.openPullRequest(repo, { title: 'child', body: EVIDENCE, head: 'stack/child', base: base.head })
  fake.setChecks(repo, base.headSha, green)
  const mr = await release.prOf(payload, t as never)
  expect(await actions.mergeGate(payload, t as never, mr!, base.headSha)).toBe('merged')
  expect(await fake.forge.getPullRequest(repo, child.number).then((p) => [p.state, p.base])).toEqual(['open', 'main'])
})

it('a Ticket whose linked MR was closed and replaced is reviewed and merged on the new MR with no DB edit', async () => {
  const old = await openPr(2001, 'old')
  const { t, id, number } = await seed('review', old)
  await fake.forge.closePullRequest(repo, old.number)
  const next = await openPr(number, 'again')
  fake.setChecks(repo, next.headSha, green)
  expect((await release.prOf(payload, t as never))?.pr.number).toBe(next.number)
  expect(await release.prOf(payload, t as never, { fallback: false })).toBeNull()
  const mr = await release.prOf(payload, t as never)
  expect(await actions.mergeGate(payload, await reload(id), mr!, next.headSha)).toBe('merged')
  expect((await fake.forge.getPullRequest(repo, next.number)).state).toBe('merged')
})

it('prOf picks the highest-numbered open replacement, never a merged or foreign one, and stays null for a Build Ticket with no MR', async () => {
  const old = await openPr(3001, 'old')
  const { t, number } = await seed('review', old)
  await fake.forge.closePullRequest(repo, old.number)
  const a = await openPr(number, 'a')
  const b = await openPr(number, 'b')
  expect(a.number).toBeLessThan(b.number)
  expect((await release.prOf(payload, t as never))?.pr.number).toBe(b.number)
  const building = await seed('build')
  await openPr(building.number, 'x')
  expect(await release.prOf(payload, building.t as never)).toBeNull()
})

it('relink_mr links an open factory MR of the Ticket and refuses a foreign branch, a closed MR and a wrong stage', async () => {
  const old = await openPr(4001, 'old')
  const { id, number } = await seed('build', old)
  const run = await payload.create({ collection: 'runs', data: { ticket: id, stage: 'build', status: 'awaiting_session', mode: 'session', workspace: ws }, ...o })
  const { leaseToken } = await claimOnly(payload, call, member, ws, run.id as number)
  const next = await openPr(number, 'next')
  const foreign = await openPr(9999, 'other')
  const closed = await openPr(number, 'closed')
  await fake.forge.closePullRequest(repo, closed.number)
  for (const prUrl of [foreign.url, closed.url, 'https://example.com/x']) await expect(call(member, 'relink_mr', { runId: run.id, leaseToken, prUrl })).rejects.toThrow(/open pull request/)
  expect(await call(member, 'relink_mr', { runId: run.id, leaseToken, prUrl: next.url })).toMatchObject({ linked: next.url })
  expect((await payload.findByID({ collection: 'runs', id: run.id, depth: 0, ...o })).artifacts).toMatchObject({ prUrl: next.url })
  await expect(call(member, 'relink_mr', { runId: run.id, leaseToken: 'bogus', prUrl: next.url })).rejects.toThrow()
})
