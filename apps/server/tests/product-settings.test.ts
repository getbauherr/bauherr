import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { deployErrors, setupOf } from '../src/app/(app)/lib/product-setup'
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

it('loadProduct answers undefined for a Product of another Workspace and shows the effective production state', async () => {
  const { loadProduct } = await import('../src/app/(app)/lib/settings')
  const [mine, other] = await Promise.all(['ps-mine', 'ps-other'].map((slug) => payload.create({ collection: 'workspaces', data: { name: slug, slug }, ...o })))
  const product = await payload.create({ collection: 'products', data: { name: 'Shop', slug: 'shop', workspace: mine!.id as number }, ...o })
  expect(await loadProduct(other!.id as number, product.id as number)).toBeUndefined()
  const found = await loadProduct(mine!.id as number, product.id as number)
  expect(found?.product.deploy.productionGate).toBe(false)
  expect(found?.product.productionOn).toBe(true)
  expect(found?.workflow.forcesProduction).toBe(true)
  expect(found?.product.deploy.releaseMode).toBe('notes-only')
  expect(found?.product.setup.production).toBe('On, needs checks')
})

const base = { repositories: [{}], sources: [{}], embedTokens: [], deploy: { stagingUrl: 'https://s.example.com', mode: 'observe-ci', webhookUrl: '', productionChecks: 'deploy-prod' } }

it('setupOf counts open steps and words the production approval', () => {
  expect(setupOf(base, true)).toMatchObject({ open: 0, production: 'On' })
  const open = setupOf({ ...base, repositories: [], deploy: { ...base.deploy, stagingUrl: '', productionChecks: '' } }, true)
  expect(open).toMatchObject({ open: 3, production: 'On, needs checks' })
  expect(open.rows.map((r) => r.word)).toEqual(['Needs setup', 'Needs setup', 'Done', 'Needs setup', 'Optional'])
  expect(setupOf({ ...base, deploy: { ...base.deploy, productionChecks: '' } }, false)).toMatchObject({ open: 0, production: 'Off' })
  expect(setupOf({ ...base, deploy: { ...base.deploy, mode: 'webhook' } }, true).rows[1]!.word).toBe('Needs setup')
})

it('deployErrors names each invalid field in plain words', () => {
  const ok = { stagingUrl: '', deployMode: 'observe-ci', deployWebhookUrl: '', productionWebhookUrl: '', productionGate: false, productionChecks: '' }
  expect(deployErrors(ok)).toEqual({})
  expect(deployErrors({ ...ok, deployMode: 'webhook' })).toEqual({
    deployWebhookUrl: 'Required when Bauherr calls your deploy hook.',
    stagingUrl: 'Required: Bauherr checks this address to see the deploy finished.',
  })
  expect(deployErrors({ ...ok, stagingUrl: 'ftp://x', productionGate: true })).toEqual({
    stagingUrl: 'Enter an address starting with https://.',
    productionChecks: 'Pick the check your production deploy reports. Without it, Bauherr cannot tell when the deploy finished.',
  })
})
