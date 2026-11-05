import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { lockedRequests } from '../src/lib/oidc-session'
import { mintAgentKey, resolveAgentKey, rotateApiKey } from '../src/lib/api-key'
import { createTestDb, type TestDb } from './helpers/test-db'

const day = 86400_000
const hidden = ['hash', 'salt', 'loginAttempts', 'lockUntil']
const states = { locked: new Date(Date.now() + day), expired: new Date(Date.now() - day), unlocked: undefined } as const

let payload: Payload
let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('account_lock')
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

const bauherr = async (name: string, lockUntil?: Date) => {
  const b = await payload.create({ collection: 'bauherren', data: { email: `${name}@x.io`, password: 'pw-123456-x', role: 'bauherr' } as never, overrideAccess: true })
  if (lockUntil) await payload.update({ collection: 'bauherren', id: b.id, data: { lockUntil: lockUntil.toISOString(), loginAttempts: 5 } as never, overrideAccess: true })
  return b
}

describe.each(Object.entries(states))('%s account', (state, lockUntil) => {
  it('agent key', async () => {
    const b = await bauherr(`agent-${state}`, lockUntil)
    const token = await mintAgentKey(payload, b, 'ci')
    if (state === 'locked') return expect(resolveAgentKey(payload, token)).rejects.toThrow(/locked/)
    const r = await resolveAgentKey(payload, token)
    expect(r?.owner.email).toBe(b.email)
    for (const k of hidden) expect(r?.owner).not.toHaveProperty(k)
  })

  it('Payload API key', async () => {
    const b = await bauherr(`apikey-${state}`, lockUntil)
    const key = await rotateApiKey(payload, b)
    const headers = new Headers({ authorization: `bauherren API-Key ${key}` })
    const user = (await payload.auth({ headers, req: { headers } as never })).user as Record<string, unknown> | null
    if (state === 'locked') {
      expect(user).toBeNull()
      return expect(lockedRequests.has(headers)).toBe(true)
    }
    expect(user?.email).toBe(b.email)
    for (const k of hidden) expect(user).not.toHaveProperty(k)
  })
})
