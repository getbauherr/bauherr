import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Payload, PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
const o = { overrideAccess: true } as const
const dir = mkdtempSync(join(tmpdir(), 'gw-'))
const IAM = JSON.stringify({ accessKeyId: 'AKIAINLINE', secretAccessKey: 'inline-s3cret' })

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('auth_143')
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

it('inline secret: absent from API reads, present only in a 0600 config.yaml, no provider file', async () => {
  const workspace = (await payload.create({ collection: 'workspaces', data: { name: 'iam', slug: 'iam' }, ...o })).id
  const c = await payload.create({
    collection: 'connections',
    data: { name: 'iam', kind: 'llm-provider', provider: 'bedrock-iam', awsRegion: 'us-east-1', secret: IAM, workspace },
    ...o,
  })
  const admin = await payload.create({ collection: 'bauherren', data: { email: 'admin@example.com', password: 'pw-admin-12345' }, ...o } as never)
  const read = await payload.findByID({ collection: 'connections', id: c.id, user: { ...admin, collection: 'bauherren' } as never, overrideAccess: false })
  expect(JSON.stringify(read)).not.toContain('inline-s3cret')
  const { renderModels } = await import('../src/lib/gateway')
  await renderModels({ payload } as unknown as PayloadRequest)
  const path = join(dir, 'config.yaml')
  expect(readFileSync(path, 'utf8')).toContain('inline-s3cret')
  expect(statSync(path).mode & 0o777).toBe(0o600)
  expect(statSync(join(dir, 'providers')).isDirectory()).toBe(true)
  expect(() => statSync(join(dir, 'providers', 'ws-iam.json'))).toThrow()
})

it('ambient identity: refused with several Workspaces, allowed with one, then a second Workspace is refused', async () => {
  const [a, b] = await Promise.all([
    payload.create({ collection: 'workspaces', data: { name: 'amb-a', slug: 'amb-a' }, ...o }),
    payload.create({ collection: 'workspaces', data: { name: 'amb-b', slug: 'amb-b' }, ...o }),
  ])
  const data = { name: 'amb', kind: 'llm-provider' as const, provider: 'bedrock-ambient' as const, awsRegion: 'us-east-1', workspace: a.id }
  await expect(payload.create({ collection: 'connections', data, ...o })).rejects.toThrow(/invalid: provider/)
  for (const slug of ['iam', 'amb-b']) {
    const ws = (await payload.find({ collection: 'workspaces', where: { slug: { equals: slug } }, ...o })).docs[0]
    await payload.delete({ collection: 'connections', where: { workspace: { equals: ws.id } }, ...o })
    await payload.delete({ collection: 'workspaces', id: ws.id, ...o })
  }
  await payload.create({ collection: 'connections', data, ...o })
  await expect(payload.create({ collection: 'workspaces', data: { name: 'c', slug: 'c' }, ...o })).rejects.toThrow(/invalid: name/)
  expect(b.slug).toBe('amb-b')
})
