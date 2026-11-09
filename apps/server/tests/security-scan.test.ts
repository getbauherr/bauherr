import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let fake: FakeBackend
let product: number
const o = { overrideAccess: true } as const
const repo = 'acme/web'

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('security_scan')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  const ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'session' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

it('a manual start creates the anchor Ticket lazily and one scan Run; a second start reuses both', async () => {
  const { startSecurityScan, SECURITY_SCAN_LABEL } = await import('../src/lib/security-scan')
  const first = await startSecurityScan(payload, product)
  expect(first.created).toBe(true)
  expect(first.run.stage).toBe('scan')
  const anchors = (await payload.find({ collection: 'tickets', where: { labels: { equals: SECURITY_SCAN_LABEL } }, ...o })).docs
  expect(anchors).toHaveLength(1)
  expect((await fake.tickets(repo).get(String(anchors[0]!.number))).labels).toContain(SECURITY_SCAN_LABEL)
  const second = await startSecurityScan(payload, product)
  expect(second.created).toBe(false)
  expect(second.run.id).toBe(first.run.id)
  expect((await payload.find({ collection: 'tickets', where: { labels: { equals: SECURITY_SCAN_LABEL } }, ...o })).docs).toHaveLength(1)
})

it('scan caps: 30 turns and $2 by default, Product overrides, budget clamped to $10', async () => {
  const { baseCaps, scanCaps, SCAN_MAX_BUDGET_USD } = await import('../src/lib/investigation')
  expect(baseCaps('scan')).toEqual({ maxTurns: 30, maxBudgetUsd: 2 })
  expect(scanCaps()).toEqual({ maxTurns: 30, maxBudgetUsd: 2 })
  expect(scanCaps({ securityScan: { maxTurns: 50, maxBudgetUsd: 4 } })).toEqual({ maxTurns: 50, maxBudgetUsd: 4 })
  expect(scanCaps({ securityScan: { maxBudgetUsd: 99 } }).maxBudgetUsd).toBe(SCAN_MAX_BUDGET_USD)
})

it('a stopped scan Run goes to the owner and never escalates', async () => {
  const { nextStep } = await import('../src/lib/escalation')
  expect(nextStep({ stage: 'scan', status: 'failed' }, false)).toBe('owner')
})

it('pack/workflow-security.yaml loads: packed() has the scan stage with the security-scan skill, after the core stages', async () => {
  delete process.env.BAUHERR_PACK_DIR
  const { packed } = await import('../src/lib/mode')
  const scan = packed().find((s) => s.name === 'scan')
  expect(scan?.steps).toEqual([{ kind: 'agent-run', skill: 'security-scan' }])
  expect(packed().map((s) => s.name)).toEqual(['triage', 'plan', 'build', 'review', 'release', 'done', 'scan'])
  expect((await import('../src/jobs')).excludedLabels()).toContain('bauherr:security-scan')
})

it('in a session-mode Workspace a scan Run is autonomous, records lastScanAt, and no session can claim it', async () => {
  const { startSecurityScan, anchorTicket } = await import('../src/lib/security-scan')
  const { callTool } = await import('../src/lib/mcp-tools')
  const ws = (await payload.find({ collection: 'workspaces', limit: 1, ...o })).docs[0]!
  const p = (await payload.create({ collection: 'products', data: { name: 'api', slug: 'api', workspace: ws.id as number, securityScan: { cron: '0 0 5 * * 1' } }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh2', kind: 'github', workspace: ws.id as number }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo: 'acme/api', product: p, connection, workspace: ws.id as number }, ...o })
  const user = await payload.create({ collection: 'bauherren', data: { email: 'scan@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws.id as number }] }, ...o })
  const call = (name: string, input: unknown) => callTool({ payload, user, actor: { kind: 'human' } } as never, name, input)

  const { run, created } = await startSecurityScan(payload, p)
  expect(created).toBe(true)
  expect(run).toMatchObject({ mode: 'autonomous', status: 'queued' })
  const after = (await payload.findByID({ collection: 'products', id: p, depth: 0, ...o })) as Record<string, any>
  expect(after.securityScan.lastScanAt).toBeTruthy()
  expect(after.securityScan.cron).toBe('0 0 5 * * 1')
  await expect(call('claim_run', { runId: run.id })).rejects.toThrow(/not awaiting_session/)

  const anchor = await anchorTicket(payload, after)
  const legacy = await payload.create({ collection: 'runs', data: { ticket: anchor.id, stage: 'scan', mode: 'session', status: 'awaiting_session', workspace: ws.id as number }, ...o })
  await expect(call('claim_run', { runId: legacy.id })).rejects.toThrow(/not awaiting_session/)
  expect((await payload.findByID({ collection: 'runs', id: legacy.id, depth: 0, ...o })).status).toBe('awaiting_session')
  const next: any = await call('claim_next', {}).catch(() => null)
  expect(next?.run?.id).not.toBe(legacy.id)
})

it('an expired session scan lease is abandoned without a strong successor', async () => {
  const jobs = await import('../src/jobs')
  const { anchorTicket } = await import('../src/lib/security-scan')
  const prod = (await payload.find({ collection: 'products', where: { slug: { equals: 'api' } }, limit: 1, ...o })).docs[0] as Record<string, any>
  const anchor = await anchorTicket(payload, prod)
  await payload.update({ collection: 'runs', where: { and: [{ ticket: { equals: anchor.id } }, { status: { in: ['awaiting_session', 'queued'] } }] }, data: { status: 'cancelled' }, ...o })
  const r = await payload.create({ collection: 'runs', data: { ticket: anchor.id, stage: 'scan', mode: 'session', status: 'running', heartbeatAt: new Date(0).toISOString(), workspace: id(prod.workspace) }, ...o })
  expect(await jobs.expireStaleSessions(payload)).toBeGreaterThan(0)
  const scans = (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: anchor.id } }, { stage: { equals: 'scan' } }, { escalation: { exists: true } }] }, ...o })).docs
  expect(scans).toHaveLength(0)
  expect((await payload.findByID({ collection: 'runs', id: r.id, depth: 0, ...o })).status).toBe('abandoned')
})

const id = (v: unknown) => (typeof v === 'object' && v ? (v as { id: number }).id : (v as number))
