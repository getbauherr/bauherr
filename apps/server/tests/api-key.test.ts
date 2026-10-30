import pg from 'pg'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { hasApiKey, revokeApiKey, rotateApiKey } from '../src/lib/api-key'

let payload: Payload
const o = { overrideAccess: true } as const

beforeAll(async () => {
  const base = process.env.DATABASE_URL ?? 'postgres://bauherr:bauherr@127.0.0.1:54330/bauherr'
  const admin = new pg.Client({ connectionString: base })
  await admin.connect()
  await admin.query('DROP DATABASE IF EXISTS bauherr_test_api_key WITH (FORCE)')
  await admin.query('CREATE DATABASE bauherr_test_api_key')
  await admin.end()
  process.env.DATABASE_URL = base.replace(/\/[^/]+$/, '/bauherr_test_api_key')
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
})

afterAll(async () => {
  await payload?.destroy()
})

const authAs = async (key: string) => (await payload.auth({ headers: new Headers({ authorization: `bauherren API-Key ${key}` }) })).user

it('rotating changes the stored key, touches only the own record, and revoking disables it', async () => {
  const [a, b] = await Promise.all(['a', 'b'].map((n) => payload.create({ collection: 'bauherren', data: { email: `${n}@x.io`, password: 'pw-123456', role: 'bauherr' }, ...o })))
  expect(await hasApiKey(payload, a!.id)).toBe(false)

  const first = await rotateApiKey(payload, a!.id)
  expect(await hasApiKey(payload, a!.id)).toBe(true)
  expect((await authAs(first))?.email).toBe('a@x.io')

  const second = await rotateApiKey(payload, a!.id)
  expect(second).not.toBe(first)
  expect(await authAs(first)).toBeNull()
  expect((await authAs(second))?.email).toBe('a@x.io')
  expect(await hasApiKey(payload, b!.id)).toBe(false)

  await revokeApiKey(payload, a!.id)
  expect(await hasApiKey(payload, a!.id)).toBe(false)
  expect(await authAs(second)).toBeNull()
})
