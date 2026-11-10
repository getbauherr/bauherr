import type { Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let ws: number
let connection: number
let n = 0
let startedAt = ''
const o = { overrideAccess: true } as const
const DAY = 86_400_000
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString()
/** Fires every minute, so any scan older than a minute is due. */
const EVERY_MINUTE = '0 * * * * *'
const NEVER_SOON = '0 0 0 1 1 *'

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('security_tick')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  process.env.DATABASE_POOL_MAX = '5'
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  ;(await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'session' }, ...o })).id as number
  connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
})

beforeEach(async () => {
  vi.restoreAllMocks()
  await payload.update({ collection: 'products', where: { id: { exists: true } }, data: { securityScan: { enabled: false } }, ...o })
  startedAt = new Date().toISOString()
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const product = async (securityScan: Record<string, unknown>) => {
  const i = ++n
  const id = (await payload.create({ collection: 'products', data: { name: `p${i}`, slug: `p${i}`, workspace: ws, securityScan }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo: `acme/p${i}`, product: id, connection, workspace: ws }, ...o })
  return id
}
const scans = async () => (await payload.find({ collection: 'runs', where: { and: [{ stage: { equals: 'scan' } }, { createdAt: { greater_than_equal: startedAt } }] }, pagination: false, depth: 0, ...o })).docs
const lastScanAt = async (id: number) => ((await payload.findByID({ collection: 'products', id, depth: 0, ...o })) as any).securityScan.lastScanAt

it('a Product whose cron has not fired since lastScanAt is not scanned', async () => {
  const { securityScanSweep } = await import('../src/jobs')
  await product({ enabled: true, cron: NEVER_SOON, lastScanAt: new Date().toISOString() })
  expect(await securityScanSweep(payload)).toBe(0)
  expect(await scans()).toHaveLength(0)
})

it('a due Product gets one scan Run and lastScanAt is set', async () => {
  const { securityScanSweep } = await import('../src/jobs')
  const id = await product({ enabled: true, cron: EVERY_MINUTE })
  expect(await lastScanAt(id)).toBeFalsy()
  expect(await securityScanSweep(payload, new Date(Date.now() + 120_000))).toBe(1)
  expect(await scans()).toHaveLength(1)
  expect(await lastScanAt(id)).toBeTruthy()
})

it('a disabled Product is never scanned', async () => {
  const { securityScanSweep } = await import('../src/jobs')
  await product({ enabled: false, cron: EVERY_MINUTE, lastScanAt: ago(30) })
  expect(await securityScanSweep(payload)).toBe(0)
  expect(await scans()).toHaveLength(0)
})

it('a spent budget skips the Product with a warning and no Run', async () => {
  const { securityScanSweep } = await import('../src/jobs')
  process.env.GATEWAY_DATABASE_URL = 'postgres://unused'
  const escalation = await import('../src/lib/escalation')
  vi.spyOn(escalation, 'budgetOut').mockResolvedValue(true)
  const warn = vi.spyOn(payload.logger, 'warn')
  await product({ enabled: true, cron: EVERY_MINUTE, lastScanAt: ago(30) })
  expect(await securityScanSweep(payload)).toBe(0)
  expect(await scans()).toHaveLength(0)
  expect(warn).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('budget'))
})

it('more than 5 due Products: only the 5 with the oldest lastScanAt run', async () => {
  const { securityScanSweep, SCANS_PER_TICK } = await import('../src/jobs')
  const ids: number[] = []
  for (let d = 1; d <= 7; d++) ids.push(await product({ enabled: true, cron: EVERY_MINUTE, lastScanAt: ago(d) }))
  expect(await securityScanSweep(payload)).toBe(SCANS_PER_TICK)
  expect(await scans()).toHaveLength(5)
  const rescanned = await Promise.all(ids.map(async (id) => new Date(await lastScanAt(id)).getTime() > Date.now() - DAY / 2))
  expect(rescanned).toEqual([false, false, true, true, true, true, true])
})

it('two concurrent ticks start one Run', async () => {
  const { securityScanSweep } = await import('../src/jobs')
  await product({ enabled: true, cron: EVERY_MINUTE, lastScanAt: ago(30) })
  await Promise.all([securityScanSweep(payload), securityScanSweep(payload)])
  expect(await scans()).toHaveLength(1)
})

it('scheduledSlugs includes the task', async () => {
  const { scheduledSlugs, securityScanTick } = await import('../src/jobs')
  expect(scheduledSlugs()).toContain(securityScanTick.slug)
})

const anchors = async (id: number) => (await payload.find({ collection: 'tickets', where: { and: [{ product: { equals: id } }, { labels: { equals: 'bauherr:security-scan' } }] }, pagination: false, depth: 0, ...o })).docs

it('a tick racing a manual start creates one anchor Ticket and one Run', async () => {
  const { securityScanSweep } = await import('../src/jobs')
  const { startSecurityScan } = await import('../src/lib/security-scan')
  const id = await product({ enabled: true, cron: EVERY_MINUTE, lastScanAt: ago(30) })
  await Promise.all([securityScanSweep(payload), startSecurityScan(payload, id)])
  expect(await anchors(id)).toHaveLength(1)
  expect(await scans()).toHaveLength(1)
})

it('more parallel starts than the pool holds finish without hanging', async () => {
  const { startSecurityScan } = await import('../src/lib/security-scan')
  const id = await product({ enabled: true, cron: EVERY_MINUTE, lastScanAt: ago(30) })
  const results = await Promise.all(Array.from({ length: 15 }, () => startSecurityScan(payload, id)))
  expect(results.filter((r) => r.created)).toHaveLength(1)
  expect(await anchors(id)).toHaveLength(1)
  expect(await scans()).toHaveLength(1)
}, 30_000)

it('a Product whose start throws is logged and backed off; the others still run and it does not block the next tick', async () => {
  const { securityScanSweep } = await import('../src/jobs')
  const scan = await import('../src/lib/security-scan')
  const bad = await product({ enabled: true, cron: EVERY_MINUTE, lastScanAt: ago(30) })
  const good = [await product({ enabled: true, cron: EVERY_MINUTE, lastScanAt: ago(2) }), await product({ enabled: true, cron: EVERY_MINUTE, lastScanAt: ago(1) })]
  const real = scan.startSecurityScan
  vi.spyOn(scan, 'startSecurityScan').mockImplementation(async (p, id) => {
    if (id === bad) throw new Error('403 on issue create')
    return real(p, id)
  })
  const error = vi.spyOn(payload.logger, 'error')
  expect(await securityScanSweep(payload)).toBe(2)
  expect(await scans()).toHaveLength(2)
  expect(error).toHaveBeenCalledWith(expect.objectContaining({ product: bad }), expect.stringContaining('failed'))
  expect(new Date(await lastScanAt(bad)).getTime()).toBeGreaterThan(Date.now() - 60_000)
  expect(await Promise.all(good.map(lastScanAt))).not.toContain(undefined)
  expect(await securityScanSweep(payload)).toBe(0)
})
