import { FakeBackend } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, beforeAll, beforeEach } from 'vitest'
import { z } from 'zod'
import type { ForgeReader, ReadTickets } from '../../src/core/forge/reader'
import { syncSources, type SyncDeps } from '../../src/core/mirror/sync'
import { createTestDb, type TestDb } from '../helpers/test-db'

export const o = { overrideAccess: true } as const
export const HOUR = 3_600_000
export const START = new Date('2026-11-19T10:00:00Z')

export const id = (doc: { id: number | string }) => z.coerce.number().parse(doc.id)

export const readerOf = (fake: FakeBackend): ForgeReader => ({
  tickets: (repo) => fake.tickets(repo),
  forge: fake.forge,
})

export const withTickets = (reader: ForgeReader, change: Partial<ReadTickets>): ForgeReader => ({
  forge: reader.forge,
  tickets: (repo) => {
    const tickets = reader.tickets(repo)
    return {
      list: (options) => tickets.list(options),
      get: (ticket) => tickets.get(ticket),
      poll: (cursor) => tickets.poll(cursor),
      listComments: (ticket, since) => tickets.listComments(ticket, since),
      ...change,
    }
  },
})

type Readers = Record<string, ForgeReader>

export const mirrorHarness = (suite: string) => {
  const state = { clock: START, n: 0 }
  const ids = { workspace: 0, product: 0, connection: 0 }
  let payload: Payload
  let testDb: TestDb

  const rows = async (query: ReturnType<typeof sql>) => (await payload.db.drizzle.execute(query)).rows

  const newSource = async (repo: string) =>
    id(
      await payload.create({
        collection: 'ticket_sources',
        data: { repo, product: ids.product, connection: ids.connection, workspace: ids.workspace },
        ...o,
      }),
    )

  const ensureSources = async (repos: string[]) => {
    for (const repo of repos) {
      const known = await rows(sql`SELECT 1 FROM "ticket_sources" WHERE "repo" = ${repo}`)
      if (known.length === 0) await newSource(repo)
    }
  }

  const sync = async (readers: Readers, afterStored?: SyncDeps['afterStored']) => {
    await ensureSources(Object.keys(readers))
    return syncSources(payload, {
      afterStored,
      now: () => state.clock,
      reader: async (source) => {
        const reader = readers[source.repo]
        if (!reader) throw new Error(`no reader for ${source.repo}`)
        return reader
      },
    })
  }

  const items = (repo: string) => rows(sql`SELECT * FROM "mirror_items" WHERE "repo" = ${repo} ORDER BY "number"`)
  const source = async (sourceId: number) =>
    (await rows(sql`SELECT * FROM "ticket_sources" WHERE "id" = ${sourceId}`))[0]
  const numbersOf = async (repo: string) => (await items(repo)).map((r) => Number(r.number))
  const fresh = () => `acme/r${++state.n}`
  const later = (ms: number) => void (state.clock = new Date(state.clock.getTime() + ms))

  const settle = async (readers: Readers) => {
    for (let i = 0; i < 10; i++) {
      await sync(readers)
      if ((await rows(sql`SELECT 1 FROM "ticket_sources" WHERE "imported_at" IS NULL`)).length === 0) return
    }
  }

  beforeAll(async () => {
    testDb = await createTestDb(suite)
    process.env.DATABASE_URL = testDb.url
    process.env.PAYLOAD_SECRET ??= 'test-secret'
    process.env.ENCRYPTION_KEY ??= 'test-key'
    delete process.env.GATEWAY_ADMIN_URL
    const { getPayload } = await import('payload')
    payload = await getPayload({ config: (await import('../../src/payload.config')).default })
    ids.workspace = id(await payload.create({ collection: 'workspaces', data: { name: 'w', slug: 'w' }, ...o }))
    const { workspace } = ids
    ids.product = id(await payload.create({ collection: 'products', data: { name: 'p', slug: 'p', workspace }, ...o }))
    const data = { name: 'gh', kind: 'github', workspace } as const
    ids.connection = id(await payload.create({ collection: 'connections', data, ...o }))
  })

  beforeEach(async () => {
    for (const table of ['mirror_checks', 'mirror_comments', 'mirror_items', 'ticket_sources']) {
      await rows(sql`DELETE FROM ${sql.identifier(table)}`)
    }
    state.clock = START
  })

  afterAll(async () => {
    await payload?.destroy()
    await testDb?.drop(payload)
  })

  return {
    ids,
    rows,
    newSource,
    sync,
    items,
    source,
    numbersOf,
    fresh,
    later,
    settle,
    payload: () => payload,
  }
}
