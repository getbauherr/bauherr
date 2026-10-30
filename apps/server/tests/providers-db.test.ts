import pg from 'pg'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

let payload: Payload
const o = { overrideAccess: true } as const

beforeAll(async () => {
  const base = process.env.DATABASE_URL ?? 'postgres://bauherr:bauherr@127.0.0.1:54330/bauherr'
  const admin = new pg.Client({ connectionString: base })
  await admin.connect()
  await admin.query('DROP DATABASE IF EXISTS bauherr_test_providers WITH (FORCE)')
  await admin.query('CREATE DATABASE bauherr_test_providers')
  await admin.end()
  process.env.DATABASE_URL = base.replace(/\/[^/]+$/, '/bauherr_test_providers')
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
})

afterAll(async () => {
  await payload?.destroy()
})

it('an llm-provider Connection needs its preset fields and mirrors the provider into config', async () => {
  const workspace = (await payload.create({ collection: 'workspaces', data: { name: 'p', slug: 'p' }, ...o })).id
  const data = { name: 'llm', kind: 'llm-provider' as const, provider: 'bedrock' as const, workspace }
  await expect(payload.create({ collection: 'connections', data, ...o })).rejects.toMatchObject({ status: 400 })
  const c = await payload.create({ collection: 'connections', data: { ...data, awsRegion: 'us-east-1' }, ...o })
  expect(c.config).toMatchObject({ provider: 'bedrock', awsRegion: 'us-east-1' })
  const viaConfig = await payload.create({ collection: 'connections', data: { name: 'g', kind: 'llm-provider', workspace, config: { provider: 'greenpt' } }, ...o })
  expect(viaConfig.provider).toBe('greenpt')
})
