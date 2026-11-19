import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { ItemRow } from '../../src/core/mirror/map'
import { searchItems, similarItems, titleAlternatives } from '../../src/core/mirror/search'
import { upsertItem } from '../../src/core/mirror/store'
import { createTestDb, type TestDb } from '../helpers/test-db'

const o = { overrideAccess: true } as const
const NOW = new Date('2026-11-19T10:00:00Z')
let payload: Payload
let testDb: TestDb
let workspace: number
let otherWorkspace: number
let web: number
let api: number
let webSource: number
let n = 0

const id = (doc: { id: number | string }) => z.coerce.number().parse(doc.id)

const row = (title: string, extra: Partial<ItemRow> = {}): ItemRow => ({
  kind: 'issue',
  number: ++n,
  title,
  body: '',
  state: 'open',
  author: 'jo',
  authorTrusted: true,
  authorIsBot: false,
  labels: [],
  assignees: [],
  url: `https://forge/${n}`,
  forgeCreatedAt: '2026-11-01T10:00:00Z',
  forgeUpdatedAt: '2026-11-01T10:00:00Z',
  forgeClosedAt: null,
  headSha: null,
  headRef: null,
  closes: [],
  draft: false,
  ...extra,
})

const store = (item: ItemRow, where: { workspace: number; product: number; source: number } = {
  workspace,
  product: web,
  source: webSource,
}) => upsertItem(payload, { ...where, repo: 'acme/web' }, item, NOW)

const titles = (hits: { title: string }[]) => hits.map((hit) => hit.title)

beforeAll(async () => {
  testDb = await createTestDb('core_mirror_search')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../../src/payload.config')).default })
  const make = async (slug: string) =>
    id(await payload.create({ collection: 'workspaces', data: { name: slug, slug }, ...o }))
  workspace = await make('alpha')
  otherWorkspace = await make('beta')
  const product = async (slug: string, ws: number) =>
    id(await payload.create({ collection: 'products', data: { name: slug, slug, workspace: ws }, ...o }))
  web = await product('web', workspace)
  api = await product('api', workspace)
  const otherProduct = await product('other', otherWorkspace)
  const connection = id(
    await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace }, ...o }),
  )
  webSource = id(
    await payload.create({
      collection: 'ticket_sources',
      data: { repo: 'acme/web', product: web, connection, workspace },
      ...o,
    }),
  )
  await store(row('Login crash on Safari', { body: 'Safari 17 crashes when I log in.' }))
  await store(row('Crash when saving a draft', { body: 'The login page is fine but saving crashes.' }))
  await store(row('Dark theme for the dashboard', { kind: 'pr', state: 'merged' }))
  await store(row('Crash crash crash', { state: 'closed' }))
  const apiSource = { workspace, product: api, source: webSource }
  await store(row('API crash on login'), apiSource)
  const otherSource = { workspace: otherWorkspace, product: otherProduct, source: webSource }
  await store(row('Crash in the other workspace'), otherSource)
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

describe('searchItems', () => {
  it('ranks the better match first and finds nothing for an unknown word', async () => {
    const hits = await searchItems(payload, { workspace, product: web, query: 'crash', limit: 10 })
    expect(titles(hits)).toEqual(['Crash crash crash', 'Login crash on Safari', 'Crash when saving a draft'])
    expect(hits[0]?.rank).toBeGreaterThan(hits[1]?.rank ?? Infinity)
    expect(await searchItems(payload, { workspace, query: 'zebra', limit: 10 })).toEqual([])
  })

  it('matches the body as well as the title', async () => {
    const hits = await searchItems(payload, { workspace, product: web, query: 'login', limit: 10 })
    expect(titles(hits)).toEqual(['Login crash on Safari', 'Crash when saving a draft'])
  })

  it('reads the query like a web search: quotes, exclusion and alternatives', async () => {
    const exclude = await searchItems(payload, { workspace, product: web, query: 'crash -safari', limit: 10 })
    expect(titles(exclude).sort()).toEqual(['Crash crash crash', 'Crash when saving a draft'])
    const either = await searchItems(payload, { workspace, product: web, query: 'dashboard or safari', limit: 10 })
    expect(titles(either).sort()).toEqual(['Dark theme for the dashboard', 'Login crash on Safari'])
  })

  it('filters by product, kind and state, and stays inside the Workspace', async () => {
    const all = await searchItems(payload, { workspace, query: 'crash', limit: 10 })
    expect(titles(all).sort()).toEqual(
      ['API crash on login', 'Crash crash crash', 'Crash when saving a draft', 'Login crash on Safari'].sort(),
    )
    expect(titles(await searchItems(payload, { workspace, product: api, query: 'crash', limit: 10 }))).toEqual([
      'API crash on login',
    ])
    expect(titles(await searchItems(payload, { workspace, query: 'dark', kind: 'pr', limit: 10 }))).toEqual([
      'Dark theme for the dashboard',
    ])
    expect(await searchItems(payload, { workspace, query: 'dark', kind: 'issue', limit: 10 })).toEqual([])
    expect(titles(await searchItems(payload, { workspace, query: 'crash', state: 'closed', limit: 10 }))).toEqual([
      'Crash crash crash',
    ])
    expect(titles(await searchItems(payload, { workspace: otherWorkspace, query: 'crash', limit: 10 }))).toEqual([
      'Crash in the other workspace',
    ])
  })

  it('honours the limit and returns the item fields', async () => {
    const hits = await searchItems(payload, { workspace, query: 'crash', limit: 2 })
    expect(hits).toHaveLength(2)
    expect(hits[0]).toMatchObject({ repo: 'acme/web', kind: 'issue', state: 'closed', title: 'Crash crash crash' })
    expect(hits[0]?.url).toMatch(/^https:\/\/forge\//)
  })

  it('leaves out an item that is gone', async () => {
    const [hit] = await searchItems(payload, { workspace, query: 'zebra stripes', limit: 5 })
    expect(hit).toBeUndefined()
    const gone = await store(row('Zebra stripes vanish'))
    const found = await searchItems(payload, { workspace, query: 'zebra', limit: 5 })
    expect(titles(found)).toEqual(['Zebra stripes vanish'])
    await payload.db.drizzle.execute(sql`UPDATE "mirror_items" SET "gone_at" = now() WHERE "id" = ${gone}`)
    expect(await searchItems(payload, { workspace, query: 'zebra', limit: 5 })).toEqual([])
  })
})

describe('similarItems', () => {
  it('ranks other items of the same Product by their match on the title', async () => {
    const [first] = await searchItems(payload, { workspace, product: web, query: 'safari', limit: 1 })
    const hits = await similarItems(payload, first?.id ?? 0, 10)
    expect(titles(hits)).toEqual(['Crash when saving a draft', 'Crash crash crash'])
  })

  it('leaves out the item itself, other Products, other Workspaces and gone items', async () => {
    const [crash] = await searchItems(payload, { workspace, product: web, query: 'saving', limit: 1 })
    const hits = await similarItems(payload, crash?.id ?? 0, 10)
    expect(titles(hits)).not.toContain('Crash when saving a draft')
    expect(titles(hits)).not.toContain('API crash on login')
    expect(titles(hits)).not.toContain('Crash in the other workspace')
    const [near] = hits
    await payload.db.drizzle.execute(sql`UPDATE "mirror_items" SET "gone_at" = now() WHERE "id" = ${near?.id ?? 0}`)
    expect(titles(await similarItems(payload, crash?.id ?? 0, 10))).not.toContain(near?.title)
  })

  it('returns nothing for an unknown item and for a title without words', async () => {
    expect(await similarItems(payload, 999_999, 5)).toEqual([])
    const bare = await store(row('!! ??'))
    expect(await similarItems(payload, bare, 5)).toEqual([])
  })

  it('turns a title into alternatives without duplicates or the word or', () => {
    expect(titleAlternatives('Crash on save, or crash on load')).toBe('crash or on or save or load')
    expect(titleAlternatives('!')).toBe('')
  })
})
