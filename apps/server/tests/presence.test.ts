import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

type Doc = Record<string, any>
const o = { overrideAccess: true } as const
let testDb: TestDb
let payload: Payload
let ws: number
let other: number
let n = 0
let loadPresence: typeof import('../src/lib/presence').loadPresence

const ago = (s: number) => new Date(Date.now() - s * 1000).toISOString()
const session = async (extra: Doc = {}, workspace = ws) => (await payload.create({ collection: 'agent_sessions', data: { publicId: `ses_p${++n}`, role: 'engineer', label: `s${n}`, connectedAt: ago(100), lastSeenAt: ago(0), workspace, ...extra } as any, ...o })) as Doc
const run = async (data: Doc, workspace = ws) => {
  const product = (await payload.create({ collection: 'products', data: { name: `p${++n}`, slug: `p${n}`, workspace }, ...o })).id
  const ticket = (await payload.create({ collection: 'tickets', data: { number: n, externalId: String(n), title: 't', product, workspace } as any, ...o })).id
  return payload.create({ collection: 'runs', data: { ticket, stage: 'build', status: 'running', workspace, ...data } as any, ...o })
}

beforeAll(async () => {
  testDb = await createTestDb('presence')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  loadPresence = (await import('../src/lib/presence')).loadPresence
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  other = (await payload.create({ collection: 'workspaces', data: { name: 'other', slug: 'other' }, ...o })).id as number
})
afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

describe('loadPresence', () => {
  it('counts nobody for a Workspace without sessions', async () => {
    expect(await loadPresence(payload, ws)).toEqual({ working: 0, idle: 0 })
  })

  it('counts idle, working, timed-out, disconnected and autonomous separately', async () => {
    await session()
    const busy = await session()
    await run({ session: busy.id, mode: 'session' })
    await session({ lastSeenAt: ago(86400) })
    await session({ disconnectedAt: ago(5) })
    await run({ mode: 'autonomous', executor: 'runner' })
    await session({}, other)
    expect(await loadPresence(payload, ws)).toEqual({ working: 2, idle: 1 })
  })

  it('keeps a session with a running Run working although its last call is old', async () => {
    const quiet = await session({ lastSeenAt: ago(86400) })
    await run({ session: quiet.id, mode: 'session' })
    expect(await loadPresence(payload, ws)).toEqual({ working: 3, idle: 1 })
  })
})
