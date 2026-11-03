import { fileURLToPath } from 'node:url'
import pg from 'pg'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

let payload: Payload
let fake: FakeBackend
let jobs: typeof import('../src/jobs')
let moveStage: typeof import('../src/lib/stage-move').moveStage
let admin: Record<string, any>
const o = { overrideAccess: true, depth: 0 } as const
const repo = 'acme/web'
const PLAN = 'bauherr:approved:plan'

beforeAll(async () => {
  const base = process.env.DATABASE_URL ?? 'postgres://bauherr:bauherr@127.0.0.1:54330/bauherr'
  const db = new pg.Client({ connectionString: base })
  await db.connect()
  await db.query('DROP DATABASE IF EXISTS bauherr_test_stage_guard_196 WITH (FORCE)')
  await db.query('CREATE DATABASE bauherr_test_stage_guard_196')
  await db.end()
  process.env.DATABASE_URL = base.replace(/\/[^/]+$/, '/bauherr_test_stage_guard_196')
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  usePack('gated-pack')
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  jobs = await import('../src/jobs')
  moveStage = (await import('../src/lib/stage-move')).moveStage
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  admin = await payload.create({ collection: 'bauherren', data: { email: 'a@x.io', password: 'pw-123456', role: 'admin', githubLogin: 'owner' }, ...o })
  const workspace = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  const product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace, gateOwners: 'owner' }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace }, ...o })
})

afterAll(async () => {
  fake.actingAs = 'factory'
  await payload?.destroy()
})

const usePack = (name: 'gated-pack' | 'bare-pack') => {
  process.env.BAUHERR_PACK_DIR = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
}
const poll = () => (jobs.pollTickets.handler as (a: unknown) => Promise<unknown>)({ req: { payload } })
const ts = () => fake.tickets(repo)
const row = async (n: string) => (await payload.find({ collection: 'tickets', where: { number: { equals: Number(n) } }, limit: 1, ...o })).docs[0]!
const runs = async (n: string, stage: string) => (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: (await row(n)).id } }, { stage: { equals: stage } }] }, ...o })).docs
const rejections = async (n: string) => (await ts().listComments(n)).filter((c) => c.body.includes('bauherr:stage-rejected'))
const known = async (stage: string) => {
  fake.actingAs = 'factory'
  const t = await ts().create({ title: 'x', labels: [`bauherr:stage:${stage}`] })
  await poll()
  return t.id
}
const relabel = async (n: string, from: string, to: string) => {
  await ts().removeLabels(n, [`bauherr:stage:${from}`])
  await ts().addLabels(n, [`bauherr:stage:${to}`])
}

it('reverts an unrecorded forward stage label with one Comment and starts no Run', async () => {
  const n = await known('plan')
  await relabel(n, 'plan', 'build')
  await poll()
  await poll()
  expect((await ts().get(n)).labels).toContain('bauherr:stage:plan')
  expect((await ts().get(n)).labels).not.toContain('bauherr:stage:build')
  expect(await rejections(n)).toHaveLength(1)
  expect((await row(n)).stage).toBe('plan')
  expect(await runs(n, 'build')).toHaveLength(0)
})

it('accepts a forward move the factory recorded and clears the record', async () => {
  const n = await known('plan')
  const r = await row(n)
  await moveStage(payload, ts(), r, 'build')
  await poll()
  const after = await row(n)
  expect(after.stage).toBe('build')
  expect(after.factoryStage ?? null).toBeNull()
  expect(await rejections(n)).toHaveLength(0)
  expect(await runs(n, 'build')).toHaveLength(1)
})

it('accepts a human backward move', async () => {
  const n = await known('review')
  await relabel(n, 'review', 'plan')
  await poll()
  expect((await row(n)).stage).toBe('plan')
  expect((await ts().get(n)).labels).toContain('bauherr:stage:plan')
  expect(await rejections(n)).toHaveLength(0)
})

it('holds an approved plan with an open critical decision', async () => {
  const n = await known('plan')
  await ts().comment(n, '<!-- bauherr:plan -->\n## Goal\n- g\n\n## Decisions\n- **D1 Name, critical**. Default: a. Alternative: b.\n')
  fake.actingAs = 'owner'
  await ts().addLabels(n, [PLAN])
  fake.actingAs = 'factory'
  await poll()
  expect((await row(n)).stage).toBe('plan')
  expect(await runs(n, 'build')).toHaveLength(0)
})
