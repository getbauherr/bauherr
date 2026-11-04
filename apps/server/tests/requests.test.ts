import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

const o = { overrideAccess: true } as const
let payload: Payload
let testDb: TestDb
let requests: typeof import('../src/app/(app)/lib/requests')
let ws: number
let product: number
let me: number

beforeAll(async () => {
  testDb = await createTestDb('requests_261')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  requests = await import('../src/app/(app)/lib/requests')
  ws = Number((await payload.create({ collection: 'workspaces', data: { name: 'r', slug: 'r' }, ...o })).id)
  product = Number((await payload.create({ collection: 'products', data: { name: 'One', slug: 'one', workspace: ws }, ...o })).id)
  me = Number((await payload.create({ collection: 'bauherren', data: { email: 'me@example.com', password: 'x-pass-123', role: 'bauherr' }, ...o } as never)).id)
  const draft = { problem: 'Export totals drift', context: '', acceptance_criteria: [], type: 'bug', links: [] }
  await payload.create({ collection: 'intake_sessions', data: { product, workspace: ws, status: 'submitted', persona: 'product-user', messages: [], draft, ticketNumber: 7 }, ...o } as never)
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

describe('loadRequests', () => {
  it('returns a plain row: Ticket number only, no stage or children; Product column only for several Products', async () => {
    const r = await requests.loadRequests(ws)
    expect(r.multiProduct).toBe(false)
    expect(r.rows).toEqual([expect.objectContaining({ title: 'Export totals drift', linked: true, ticket: { number: 7, id: undefined } })])
    await payload.create({ collection: 'products', data: { name: 'Two', slug: 'two', workspace: ws }, ...o })
    expect((await requests.loadRequests(ws)).multiProduct).toBe(true)
  })

  it('marks only own open Drafts resumable and hides owner-persona sessions', async () => {
    const draft = (problem: string) => ({ problem, context: '', acceptance_criteria: [], type: 'bug', links: [] })
    const mk = (problem: string, extra: Record<string, unknown>) => payload.create({ collection: 'intake_sessions', data: { product, workspace: ws, status: 'open', persona: 'product-user', messages: [], draft: draft(problem), ...extra }, ...o } as never)
    const mine = await mk('Own draft', { user: me })
    await mk('Embed draft', {})
    await mk('Owner flow', { user: me, persona: 'owner' })
    const { rows } = await requests.loadRequests(ws, me)
    expect(rows.find((r) => r.id === Number(mine.id))?.resumable).toBe(true)
    expect(rows.find((r) => r.title === 'Embed draft')?.resumable).toBe(false)
    expect(rows.find((r) => r.title === 'Export totals drift')?.resumable).toBe(false)
    expect(rows.some((r) => r.title === 'Owner flow')).toBe(false)
    expect((await requests.loadRequests(ws)).rows.some((r) => r.resumable)).toBe(false)
  })
})
