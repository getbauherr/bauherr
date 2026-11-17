import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

const o = { overrideAccess: true } as const
const repo = 'acme/web'
let payload: Payload
let fake: FakeBackend
let ws: number
let product: number
let member: Record<string, any>
let outsider: Record<string, any>
let call: (user: Record<string, any>, name: string, input: unknown) => Promise<any>

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('mcp_worklog_staging_skill')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  const { callTool } = await import('../src/lib/mcp-tools')
  call = (user, name, input) => callTool({ payload, user, actor: { kind: 'human' } }, name, input)
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  const other = (await payload.create({ collection: 'workspaces', data: { name: 'other', slug: 'other' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
  member = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
  outsider = await payload.create({ collection: 'bauherren', data: { email: 'out@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: other }] }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const ticketIn = async (stage: string, title: string) => {
  const issue = await fake.tickets(repo).create({ title, labels: [`bauherr:stage:${stage}`] })
  const t = await payload.create({ collection: 'tickets', data: { title, externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage, product, workspace: ws }, ...o })
  return { id: t.id as number, n: String(issue.number) }
}

it('read_worklog is empty before and returns what update_worklog wrote', async () => {
  const { id } = await ticketIn('build', 'worklog')
  expect(await call(member, 'read_worklog', { ticket: id })).toBe('')
  expect(await call(member, 'update_worklog', { ticket: id, markdown: '## Done\n- first' })).toMatchObject({ created: true })
  expect(await call(member, 'update_worklog', { ticket: id, markdown: '## Done\n- second' })).toMatchObject({ created: false })
  expect(await call(member, 'read_worklog', { ticket: id })).toBe('## Done\n- second')
})

it('worklog tools refuse a Ticket of another Workspace', async () => {
  const { id } = await ticketIn('build', 'foreign')
  await expect(call(outsider, 'read_worklog', { ticket: id })).rejects.toThrow()
  await expect(call(outsider, 'update_worklog', { ticket: id, markdown: 'x' })).rejects.toThrow()
})

it('post_staging_summary posts once per merge commit', async () => {
  const { id, n } = await ticketIn('release', 'in release')
  expect(await call(member, 'post_staging_summary', { ticket: id })).toEqual({ posted: true })
  expect(await call(member, 'post_staging_summary', { ticket: id })).toEqual({ posted: false })
  expect((await fake.tickets(repo).listComments(n)).filter((c) => c.body.startsWith('<!-- bauherr:staging-summary -->'))).toHaveLength(1)
})

it('post_staging_summary refuses a Ticket outside release and one of another Workspace', async () => {
  const build = await ticketIn('build', 'still building')
  await expect(call(member, 'post_staging_summary', { ticket: build.id })).rejects.toThrow('the Ticket is not in release')
  const release = await ticketIn('release', 'foreign release')
  await expect(call(outsider, 'post_staging_summary', { ticket: release.id })).rejects.toThrow()
})

it('load_skill returns the skill text and refuses an invalid or unknown name', async () => {
  const text = await call(member, 'load_skill', { name: 'worklog' })
  expect(text).toContain('worklog')
  await expect(call(member, 'load_skill', { name: '../secrets' })).rejects.toThrow('invalid skill name')
  await expect(call(member, 'load_skill', { name: 'no-such-skill' })).rejects.toThrow()
})
