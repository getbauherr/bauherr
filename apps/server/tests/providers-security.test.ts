import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import type { Payload, PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
const o = { overrideAccess: true } as const
const dir = mkdtempSync(join(tmpdir(), 'gw-sec-'))
const RAW = 'AKIARAWKEYPASTEDHERE+s3cr3t/value'
const iam = (extra = {}) => JSON.stringify({ accessKeyId: 'AKIAOK', secretAccessKey: 'sec-ok', ...extra })
const ws = async (slug: string) => (await payload.create({ collection: 'workspaces', data: { name: slug, slug }, ...o })).id
const conn = (workspace: number | string, data: Record<string, unknown>, extra: Record<string, unknown> = o) =>
  payload.create({ collection: 'connections', data: { name: 'c', kind: 'llm-provider', workspace, ...data } as never, ...extra } as never)

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('security_143')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.GATEWAY_CONFIG_DIR = dir
  delete process.env.GATEWAY_ADMIN_URL
  mkdirSync(join(dir, 'providers'))
  writeFileSync(join(dir, 'config.yaml'), 'llm:\n  models: []\n')
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

it('bedrock-iam secret: raw key, non-object and missing fields are rejected with a fixed message that never echoes the input', async () => {
  const workspace = await ws('v1')
  for (const secret of [RAW, '"str"', 'null', '[]', JSON.stringify({ accessKeyId: 'a' }), JSON.stringify({ accessKeyId: '', secretAccessKey: 'b' }), iam({ sessionToken: 5 })]) {
    const err = await conn(workspace, { provider: 'bedrock-iam', awsRegion: 'us-east-1', secret }).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(JSON.stringify([err.message, err.data])).not.toContain('AKIARAWKEY')
    expect(JSON.stringify([err.message, err.data])).not.toContain('s3cr3t')
  }
  await expect(conn(workspace, { provider: 'bedrock-iam', awsRegion: 'us-east-1', secret: iam({ sessionToken: 'tok' }) })).resolves.toMatchObject({ provider: 'bedrock-iam' })
})

it('renderModels skips a Connection with a corrupt stored secret and still renders the others', async () => {
  const { encrypt } = await import('../src/lib/secrets')
  const { renderModels } = await import('../src/lib/gateway')
  const bad = await conn(await ws('bad'), { provider: 'bedrock-iam', awsRegion: 'us-east-1', secret: iam() })
  await conn(await ws('good'), { provider: 'bedrock-iam', awsRegion: 'us-east-1', secret: iam({ accessKeyId: 'AKIAGOOD' }) })
  await payload.update({ collection: 'connections', id: bad.id, data: { secret: encrypt(RAW) }, ...o })
  await renderModels({ payload } as unknown as PayloadRequest)
  const out = readFileSync(join(dir, 'config.yaml'), 'utf8')
  expect(out).toContain('ws-good/bedrock-iam/*')
  expect(out).toContain('AKIAGOOD')
  expect(out).not.toContain('ws-bad/bedrock-iam/*')
})

it('azure fields are validated before they reach the gateway baseUrl', async () => {
  const workspace = await ws('az')
  const entra = { provider: 'foundry-entra', secret: 'client-secret', azureResource: 'res-1', azureTenant: 'contoso.onmicrosoft.com', azureClient: '11111111-2222-3333-4444-555555555555' }
  for (const bad of [{ azureResource: 'evil.com/x?' }, { azureResource: 'a'.repeat(64) }, { azureTenant: 'x/../y' }, { azureClient: 'not-a-guid' }]) {
    await expect(conn(workspace, { ...entra, ...bad })).rejects.toThrow(/invalid/)
  }
  await expect(conn(workspace, { ...entra, azureTenant: '11111111-2222-3333-4444-555555555555' })).resolves.toMatchObject({ provider: 'foundry-entra' })
})

it('inline and ambient presets can be set by Admins only; file presets stay open', async () => {
  const workspace = await ws('adm')
  const admin = await payload.create({ collection: 'bauherren', data: { email: 'a@example.com', password: 'pw-admin-12345' }, ...o } as never)
  const user = await payload.create({ collection: 'bauherren', data: { email: 'u@example.com', password: 'pw-user-12345', tenants: [{ tenant: workspace }] }, ...o } as never)
  expect(admin.role).toBe('admin')
  expect(user.role).toBe('bauherr')
  const as = (u: object) => ({ user: { ...u, collection: 'bauherren' }, overrideAccess: false })
  await expect(conn(workspace, { provider: 'bedrock-iam', awsRegion: 'us-east-1', secret: iam() }, as(user))).rejects.toThrow(/invalid: provider/)
  await expect(conn(workspace, { provider: 'bedrock-ambient', awsRegion: 'us-east-1' }, as(user))).rejects.toThrow(/invalid: provider/)
  await expect(conn(workspace, { provider: 'bedrock', awsRegion: 'us-east-1' }, as(user))).resolves.toMatchObject({ provider: 'bedrock' })
  await expect(conn(workspace, { provider: 'bedrock-iam', awsRegion: 'us-east-1', secret: iam() }, as(admin))).resolves.toMatchObject({ provider: 'bedrock-iam' })
})

it('concurrent ambient Connection create and Workspace create: exactly one succeeds', async () => {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  await db.query('DELETE FROM connections')
  await db.end()
  const [keep, ...rest] = (await payload.find({ collection: 'workspaces', pagination: false, ...o })).docs
  for (const w of rest) await payload.delete({ collection: 'workspaces', id: w.id, ...o })
  const results = await Promise.allSettled([
    conn(keep.id, { provider: 'bedrock-ambient', awsRegion: 'us-east-1' }),
    payload.create({ collection: 'workspaces', data: { name: 'late', slug: 'late' }, ...o }),
  ])
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
})

it('renderModels replaces a stale config.yaml.tmp so the 0600 mode always applies', async () => {
  const { renderModels } = await import('../src/lib/gateway')
  const tmp = join(dir, 'config.yaml.tmp')
  writeFileSync(tmp, 'stale')
  chmodSync(tmp, 0o644)
  await renderModels({ payload } as unknown as PayloadRequest)
  expect(statSync(join(dir, 'config.yaml')).mode & 0o777).toBe(0o600)
})
