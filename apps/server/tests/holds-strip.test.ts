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
  const load = async () => {
    vi.doMock('../src/app/(app)/lib/session', () => ({ payloadClient: async () => payload }))
    return (await import('../src/app/(app)/lib/holds-strip')).loadHolds
  }

  it('asks holdsOf once per TTL, also for concurrent callers', async () => {
    const loadHolds = await load()
    const find = vi.fn(async () => [])
    await Promise.all([loadHolds(999, 1000, find), loadHolds(999, 1000, find)])
    await loadHolds(999, 2000, find)
    expect(find).toHaveBeenCalledTimes(1)
    await loadHolds(999, 7000, find)
    expect(find).toHaveBeenCalledTimes(2)
  })

  it('shows no strip instead of failing when holdsOf throws, and retries next time', async () => {
    const loadHolds = await load()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const find = vi.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValue([])
    expect(await loadHolds(998, 1000, find)).toEqual([])
    expect(err).toHaveBeenCalled()
    await loadHolds(998, 1001, find)
    expect(find).toHaveBeenCalledTimes(2)
    err.mockRestore()
  })
})

describe('shell', () => {
  it('renders the strip for a held fast lane through the layout loader and AppShell, and drops it after release', async () => {
    vi.doMock('../src/app/(app)/lib/session', () => ({ payloadClient: async () => payload }))
    vi.doMock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({}), useSearchParams: () => new URLSearchParams() }))
    const { loadHolds } = await import('../src/app/(app)/lib/holds-strip')
    const { AppShell } = await import('../src/app/(app)/components/AppShell')
    const shell = async (now: number) =>
      renderToStaticMarkup(createElement(AppShell, { defaultOpen: true, presence: { working: 0, idle: 0 }, holds: await loadHolds(ws, now), version: 'dev', email: 'a@b.c', admin: false, workspaces: [], needsYou: 0, drafts: 0, hasKnowledge: false, logout: async () => {}, selectWorkspace: async () => {}, children: 'page' } as never))
    const holder = await ticket({ stage: 'build', expedite: true })
    await ticket({ expedite: true })
    const held = await shell(10_000)
    expect(held).toContain('data-testid="holds-strip"')
    expect(held).toContain(`href="/tickets/${holder.id}"`)
    await payload.update({ collection: 'tickets', id: holder.id, data: { expedite: false, state: 'closed' }, ...o })
    expect(await shell(20_000)).not.toContain('holds-strip')
  })
})
