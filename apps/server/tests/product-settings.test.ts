import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { setupOf } from '../src/app/(app)/lib/product-setup'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
const o = { overrideAccess: true } as const
vi.mock('../src/app/(app)/lib/session', () => ({ payloadClient: async () => payload, workspacesOf: async () => [] }))

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('product_settings')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

it('productSettings answers null for a Product of another Workspace and reads the defaults', async () => {
  const { productSettings } = await import('../src/core/views/product-settings')
  const [mine, other] = await Promise.all(
    ['ps-mine', 'ps-other'].map((slug) =>
      payload.create({ collection: 'workspaces', data: { name: slug, slug }, ...o }),
    ),
  )
  const product = await payload.create({
    collection: 'products',
    data: { name: 'Shop', slug: 'shop', workspace: mine.id },
    ...o,
  })
  expect(await productSettings(payload, { workspace: other.id as number, product: product.id as number })).toBeNull()
  expect(await productSettings(payload, { workspace: mine.id as number, product: product.id as number })).toMatchObject(
    {
      state: 'observing',
      executor: 'session',
      riskAreas: [],
      excludedLabels: ['bauherr:someday'],
      outsideIssuesPerDay: 5,
      reporterRemindDays: 7,
      reporterSilentDays: 21,
      backlogBriefLimit: 5,
      autoClose: true,
      autoAccept: false,
      autoAcceptMaxSendBack: 10,
      sources: [],
    },
  )
})

it("loadWorkspaceSettings offers the preset models and shows the first Connection's tiers as bare ids", async () => {
  const { loadWorkspaceSettings } = await import('../src/app/(app)/lib/settings')
  const workspace = (
    await payload.create({ collection: 'workspaces', data: { name: 'ps-tiers', slug: 'ps-tiers' }, ...o })
  ).id as number
  await payload.create({
    collection: 'connections',
    data: { name: 'Anthropic', kind: 'llm-provider', provider: 'anthropic', config: {}, secret: 'k', workspace },
    ...o,
  })
  await payload.create({
    collection: 'connections',
    data: { name: 'Greenpt', kind: 'llm-provider', provider: 'greenpt', config: {}, secret: 'k', workspace },
    ...o,
  })
  await payload.update({
    collection: 'workspaces',
    id: workspace,
    data: {
      modelByTier: {
        cheap: 'anthropic/claude-haiku-5-5',
        standard: 'greenpt/glm-5.3',
        strong: 'anthropic/claude-opus-5-5',
      },
    },
    ...o,
  })
  const w = await loadWorkspaceSettings(workspace)
  expect(w.modelChoices).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'])
  expect(w.modelByTier).toEqual({ cheap: 'claude-haiku-5-5', standard: 'greenpt/glm-5.3', strong: 'claude-opus-5-5' })
})

const base = {
  repositories: [{}],
  sources: [{}],
  deploy: { stagingUrl: 'https://s.example.com' },
}

it('setupOf counts open steps', () => {
  expect(setupOf(base)).toMatchObject({ open: 0 })
  const open = setupOf({ ...base, repositories: [], deploy: { ...base.deploy, stagingUrl: '' } })
  expect(open).toMatchObject({ open: 2 })
  expect(open.rows.map((r) => r.word)).toEqual(['Needs setup', 'Needs setup'])
})
