import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { HoldsStrip } from '../src/app/(app)/components/HoldsStrip'
import { createTestDb, type TestDb } from './helpers/test-db'

type Doc = Record<string, any>
const o = { overrideAccess: true } as const
let testDb: TestDb
let payload: Payload
let ws: number
let product: number
let n = 0
let holdsOf: typeof import('../src/lib/holds').holdsOf

const ticket = async (extra: Doc = {}) => {
  ++n
  return (await payload.create({ collection: 'tickets', data: { number: n, externalId: String(n), title: `t${n}`, state: 'open', product, workspace: ws, ...extra } as any, ...o })) as Doc
}
const strip = async () => renderToStaticMarkup(createElement(HoldsStrip, { holds: await holdsOf(payload, ws) }))

beforeAll(async () => {
  testDb = await createTestDb('holds_608')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  holdsOf = (await import('../src/lib/holds')).holdsOf
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', expediteLane: true }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
})
afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})
beforeEach(async () => {
  await payload.delete({ collection: 'tickets', where: { workspace: { equals: ws } }, ...o })
})

describe('Holding up work strip', () => {
  it('shows a held fast lane with the holder link until it is released', async () => {
    const holder = await ticket({ stage: 'build', expedite: true })
    await ticket({ expedite: true })
    const held = await strip()
    expect(held).toContain('data-testid="holds-strip"')
    expect(held).toContain('Holding up work')
    expect(held).toContain(`href="/tickets/${holder.id}"`)
    expect(held).toContain(`Waiting for the fast lane: #${holder.number} holds it.`)
    await payload.update({ collection: 'tickets', id: holder.id, data: { expedite: false, state: 'closed' }, ...o })
    expect(await strip()).toBe('')
  })

  it('renders nothing without holds, and never says Blocked', async () => {
    await ticket({ stage: 'build' })
    expect(await strip()).toBe('')
    const html = renderToStaticMarkup(createElement(HoldsStrip, { holds: [{ text: 'Build is full (1/1)', href: '/?stage=build', waiting: [{ id: 1, number: 1, href: '/tickets/1' }] }] }))
    expect(html).toContain('href="/?stage=build"')
    expect(html).not.toMatch(/blocked/i)
  })
})

describe('loadHolds', () => {
  it('asks holdsOf once per TTL', async () => {
    vi.doMock('../src/app/(app)/lib/session', () => ({ payloadClient: async () => payload }))
    const { loadHolds } = await import('../src/app/(app)/lib/holds-strip')
    const find = vi.fn(async () => [])
    await loadHolds(999, 1000, find)
    await loadHolds(999, 2000, find)
    await loadHolds(999, 7000, find)
    expect(find).toHaveBeenCalledTimes(2)
  })
})
