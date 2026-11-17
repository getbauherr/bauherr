import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let testDb: TestDb
const o = { overrideAccess: true } as const

beforeAll(async () => {
  testDb = await createTestDb('run_kind')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
}, 120_000)

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

it('every Run started through startRunIfNeeded records its stage kind; an unknown stage is rejected', async () => {
  const { startRunIfNeeded } = await import('../src/jobs')
  const ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  const product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const t = await payload.create({ collection: 'tickets', data: { product, workspace: ws, externalId: 'k1', number: '1', title: 'T', stage: 'build' } as never, ...o })
  for (const stage of ['triage', 'plan', 'build', 'review']) {
    const { run } = await startRunIfNeeded(payload, { id: t.id, workspace: ws }, stage)
    expect(run).toMatchObject({ stage, kind: stage })
  }
  await expect(startRunIfNeeded(payload, { id: t.id, workspace: ws }, 'nope')).rejects.toThrow()
  expect((await payload.find({ collection: 'runs', where: { stage: { equals: 'nope' } }, ...o })).totalDocs).toBe(0)
})

it('startRunIfNeeded keys the active Run by job: one per job, the stage\'s own Job has none', async () => {
  const { startRunIfNeeded } = await import('../src/jobs')
  const ws = (await payload.create({ collection: 'workspaces', data: { name: 'jobs', slug: 'jobs' }, ...o })).id as number
  const product = (await payload.create({ collection: 'products', data: { name: 'j', slug: 'j', workspace: ws }, ...o })).id as number
  const t = await payload.create({ collection: 'tickets', data: { product, workspace: ws, externalId: 'j1', number: '1', title: 'T', stage: 'build' } as never, ...o })
  const start = (job?: string) => startRunIfNeeded(payload, { id: t.id, workspace: ws }, 'build', job ? { job } : {})
  const own = await start()
  const security = await start('security')
  expect(security).toMatchObject({ created: true, run: { job: 'security' } })
  expect(security.run.id).not.toBe(own.run.id)
  expect(await start('security')).toMatchObject({ created: false, run: { id: security.run.id } })
  expect(await start()).toMatchObject({ created: false, run: { id: own.run.id } })
})
