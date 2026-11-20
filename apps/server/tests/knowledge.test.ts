import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { FakeBackend } from '@bauherr/adapters'
import { createTestDb, type TestDb } from './helpers/test-db'

let fakeBackend: FakeBackend
vi.mock('../src/lib/adapters', () => ({ backendFor: () => fakeBackend }))

const anyString: unknown = expect.any(String)
const REPO = 'acme/knowledge'
const o = { overrideAccess: true } as const
let payload: Payload
let knowledge: typeof import('../src/lib/knowledge')
let withRepo: number
let withoutRepo: number

let testDb: TestDb
beforeAll(async () => {
  fakeBackend = new FakeBackend()
  fakeBackend.commit(REPO, 'main', 'workspace/rules/evidence.md', '# Evidence\n\nHouse rule: giraffe proof.\n')
  fakeBackend.commit(REPO, 'main', 'products/web/notes.md', '# Notes\n\nWeb only okapi note.\n')
  fakeBackend.commit(REPO, 'main', 'products/api/notes.md', '# Notes\n\nApi only okapi note.\n')
  fakeBackend.commit(REPO, 'main', 'handbook.md', '# Handbook\n\nokapi okapi okapi okapi\n\n## Other\n\nokapi\n')
  fakeBackend.commit(REPO, 'main', 'image.png', 'okapi binary')

  testDb = await createTestDb('knowledge_150')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  knowledge = await import('../src/lib/knowledge')
  withoutRepo = Number((await payload.create({ collection: 'workspaces', data: { name: 'b', slug: 'b' }, ...o })).id)
  const a = Number((await payload.create({ collection: 'workspaces', data: { name: 'a', slug: 'a' }, ...o })).id)
  const conn = await payload.create({
    collection: 'connections',
    data: { name: 'gh', kind: 'github', workspace: a },
    ...o,
  })
  await payload.update({
    collection: 'workspaces',
    id: a,
    data: { knowledgeConnection: conn.id, knowledgeRepo: REPO },
    ...o,
  })
  withRepo = a
  expect(await knowledge.resync(payload, a)).toBe(true)
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

describe('chunk', () => {
  it('splits at headings, keeps fenced # lines, and reproduces the document', () => {
    const md = '# A\nintro\n```\n# not a heading\n```\n## B\nbody\n'
    const chunks = knowledge.chunk(md)
    expect(chunks.map((c) => c.heading)).toEqual(['A', 'B'])
    expect(chunks.map((c) => c.text).join('')).toBe(md)
  })
  it('splits an oversized section under the same heading', () => {
    const md = '# Big\n' + 'line of text\n'.repeat(600)
    const chunks = knowledge.chunk(md)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((c) => c.heading === 'Big' && c.text.length <= 3200)).toBe(true)
    expect(chunks.map((c) => c.text).join('')).toBe(md)
  })
})

describe('search', () => {
  it('finds a repo document with source, path, heading and commit, and skips non-markdown files', async () => {
    const hits = await knowledge.search(payload, withRepo, 'giraffe')
    expect(hits).toEqual([
      expect.objectContaining({
        source: REPO,
        path: 'workspace/rules/evidence.md',
        heading: 'Evidence',
        commit: anyString,
      }),
    ])
    expect((await knowledge.search(payload, withRepo, 'binary')).length).toBe(0)
  })

  it('shows a product layer only to that product', async () => {
    const all = (p?: string) =>
      knowledge.search(payload, withRepo, 'okapi note', 20, p).then((h) => h.map((x) => x.path))
    expect(await all()).toEqual([])
    expect(await all('web')).toEqual(['products/web/notes.md'])
  })

  it('ranks the better match first', async () => {
    const hits = await knowledge.search(payload, withRepo, 'okapi')
    expect(hits[0]).toMatchObject({ path: 'handbook.md', heading: 'Handbook' })
  })

  it('never returns another Workspace documents', async () => {
    expect(await knowledge.search(payload, withoutRepo, 'giraffe')).toEqual([])
  })
})

describe('resync', () => {
  it('re-indexes only when the default-branch commit changed', async () => {
    const getFile = vi.spyOn(fakeBackend.forge, 'getFile')
    expect(await knowledge.resync(payload, withRepo)).toBe(false)
    expect(getFile).not.toHaveBeenCalled()

    fakeBackend.commit(REPO, 'main', 'handbook.md', '# Handbook\n\nnarwhal arrives\n')
    expect(await knowledge.resync(payload, withRepo)).toBe(true)
    expect(getFile).toHaveBeenCalled()
    const hits = await knowledge.search(payload, withRepo, 'narwhal')
    expect(hits[0]).toMatchObject({ path: 'handbook.md', source: REPO })
    expect((await knowledge.search(payload, withRepo, 'okapi okapi')).map((h) => h.path)).not.toContain('handbook.md')
    expect(await knowledge.resync(payload, withRepo)).toBe(false)
  })

  it('keeps the old index when the forge fails and drops it when the repo is unset', async () => {
    fakeBackend.commit(REPO, 'main', 'extra.md', '# Extra\n\nquokka\n')
    const fail = vi.spyOn(fakeBackend.forge, 'listFiles').mockRejectedValueOnce(new Error('down'))
    expect(await knowledge.resync(payload, withRepo)).toBe(false)
    fail.mockRestore()
    expect((await knowledge.search(payload, withRepo, 'narwhal')).length).toBe(1)

    await payload.update({ collection: 'workspaces', id: withRepo, data: { knowledgeRepo: null }, ...o })
    expect(await knowledge.resync(payload, withRepo)).toBe(true)
    expect(await knowledge.search(payload, withRepo, 'narwhal')).toEqual([])
  })
})

describe('repo switch, failure back-off and fencing', () => {
  const OTHER = 'acme/other'
  const makeWs = async (slug: string, repo: string) => {
    const w = Number((await payload.create({ collection: 'workspaces', data: { name: slug, slug }, ...o })).id)
    const conn = await payload.create({
      collection: 'connections',
      data: { name: 'gh', kind: 'github', workspace: w },
      ...o,
    })
    await payload.update({
      collection: 'workspaces',
      id: w,
      data: { knowledgeConnection: conn.id, knowledgeRepo: repo },
      ...o,
    })
    return w
  }

  it('switching knowledgeRepo A to B drops As chunks', async () => {
    fakeBackend.commit('acme/a', 'main', 'a.md', '# A\n\naardvark\n')
    fakeBackend.commit('acme/b', 'main', 'b.md', '# B\n\nbonobo\n')
    const w = await makeWs('switch', 'acme/a')
    await knowledge.resync(payload, w)
    expect((await knowledge.search(payload, w, 'aardvark')).length).toBe(1)
    await payload.update({ collection: 'workspaces', id: w, data: { knowledgeRepo: 'acme/b' }, ...o })
    await knowledge.resync(payload, w)
    expect(await knowledge.search(payload, w, 'aardvark')).toEqual([])
    expect((await knowledge.search(payload, w, 'bonobo')).length).toBe(1)
  })

  it('does not refetch a failing repo until the back-off passed', async () => {
    fakeBackend.commit(OTHER, 'main', 'x.md', '# X\n\nx\n')
    const w = await makeWs('backoff', OTHER)
    const list = vi.spyOn(fakeBackend.forge, 'listFiles').mockRejectedValue(new Error('down'))
    await knowledge.resync(payload, w)
    await knowledge.resync(payload, w)
    expect(list).toHaveBeenCalledTimes(1)
    list.mockRestore()
  })
})

describe('Product docs', () => {
  let w: number
  let conn: number
  let PA: string
  let PB: string
  const addProduct = async (slug: string, repo: string) => {
    const product = (await payload.create({ collection: 'products', data: { name: slug, slug, workspace: w }, ...o }))
      .id
    await payload.create({ collection: 'repositories', data: { fullName: repo, product, workspace: w }, ...o })
    await payload.create({
      collection: 'ticket_sources',
      data: { repo, product, connection: conn, cursor: '2026-10-30T09:00:00Z', workspace: w },
      ...o,
    })
    return product
  }
  const sources = async () =>
    (
      (
        await payload.db.drizzle.execute(
          sql`SELECT DISTINCT "source", "path" FROM "knowledge_chunks" WHERE "workspace_id" = ${w} AND "path" LIKE
            '%.md'`,
        )
      ).rows as { source: string; path: string }[]
    ).map((d) => `${d.source}:${d.path}`)

  beforeAll(async () => {
    const fb = fakeBackend
    fb.commit('acme/pa', 'main', 'README.md', '# Pa\n\nlemur readme\n')
    fb.commit('acme/pa', 'main', 'docs/guide/setup.md', '# Setup\n\nlemur setup\n')
    fb.commit('acme/pa', 'main', 'docs/logo.png', 'lemur binary')
    fb.commit('acme/pa', 'main', 'src/notes.md', '# Notes\n\nlemur outside docs\n')
    fb.commit('acme/pb', 'main', 'README.md', '# Pb\n\nmeerkat readme\n')
    fb.commit('acme/pa', 'main', 'docs/evidence.md', '# Evidence\n\nlemur shadow try\n')
    w = Number((await payload.create({ collection: 'workspaces', data: { name: 'pd', slug: 'pd' }, ...o })).id)
    conn = Number(
      (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: w }, ...o }))
        .id,
    )
    PA = `acme/pa#${await addProduct('pa', 'acme/pa')}`
    PB = `acme/pb#${await addProduct('pb', 'acme/pb')}`
    expect(await knowledge.resync(payload, w)).toBe(true)
  })

  it('indexes README and docs with source, layer, product and logical path', async () => {
    expect(await sources()).toEqual(
      expect.arrayContaining([`${PA}:README.md`, `${PA}:docs/guide/setup.md`, `${PB}:README.md`]),
    )
    expect(await sources()).not.toContain(`${PA}:src/notes.md`)
    const r = await payload.db.drizzle.execute(
      sql`SELECT "layer", "product", "logical" FROM "knowledge_chunks" WHERE "workspace_id" = ${w} AND "source" = ${PA}
        AND "path" = 'docs/guide/setup.md'`,
    )
    expect(r.rows[0]).toEqual({ layer: 'product', product: 'pa', logical: 'repo-docs/docs/guide/setup.md' })
  })

  it('shows a Product its own docs only', async () => {
    const paths = (p?: string, q = 'lemur OR meerkat') =>
      knowledge.search(payload, w, q, 20, p).then((h) => h.map((x) => `${x.source}:${x.path}`).sort())
    expect(await paths('pa')).toEqual([`${PA}:README.md`, `${PA}:docs/evidence.md`, `${PA}:docs/guide/setup.md`])
    expect(await paths('pb')).toEqual([`${PB}:README.md`])
    expect(await paths()).toEqual([])
  })

  it('re-indexes on a changed commit, not on an unchanged one', async () => {
    const getFile = vi.spyOn(fakeBackend.forge, 'getFile')
    expect(await knowledge.resync(payload, w)).toBe(false)
    expect(getFile).not.toHaveBeenCalled()
    fakeBackend.commit('acme/pb', 'main', 'docs/new.md', '# New\n\nmeerkat novelty\n')
    expect(await knowledge.resync(payload, w)).toBe(true)
    expect((await knowledge.search(payload, w, 'novelty', 20, 'pb')).length).toBe(1)
    expect(getFile.mock.calls.every(([repo]) => repo === 'acme/pb')).toBe(true)
    getFile.mockRestore()
  })

  it('keeps the old index of a failing repo and backs off', async () => {
    fakeBackend.commit('acme/pa', 'main', 'docs/more.md', '# More\n\nlemur more\n')
    const list = vi.spyOn(fakeBackend.forge, 'listFiles').mockImplementation(async (repo: string) => {
      if (repo === 'acme/pa') throw new Error('down')
      return { commit: 'x', paths: [], truncated: false }
    })
    await knowledge.resync(payload, w)
    await knowledge.resync(payload, w)
    expect(list.mock.calls.filter(([repo]) => repo === 'acme/pa')).toHaveLength(1)
    list.mockRestore()
    expect(await sources()).toContain(`${PA}:README.md`)
    expect(await sources()).not.toContain(`${PA}:docs/more.md`)
  })

  it('drops the chunks of a removed Product', async () => {
    const pb = (
      await payload.find({ collection: 'products', where: { slug: { equals: 'pb' }, workspace: { equals: w } }, ...o })
    ).docs[0]
    await payload.delete({ collection: 'ticket_sources', where: { product: { equals: pb.id } }, ...o })
    await payload.delete({ collection: 'repositories', where: { product: { equals: pb.id } }, ...o })
    await payload.delete({ collection: 'products', id: pb.id, ...o })
    expect(await knowledge.resync(payload, w)).toBe(true)
    expect((await sources()).filter((s) => s.startsWith(PB))).toEqual([])
    expect(await sources()).toContain(`${PA}:README.md`)
  })
})

describe('Product docs sharing a repo', () => {
  it('keeps both Products chunks, and skips a Product on the Knowledge repo', async () => {
    const fb = fakeBackend
    fb.commit('acme/shared', 'main', 'README.md', '# Shared\n\nnarwhal readme\n')
    const ws = Number((await payload.create({ collection: 'workspaces', data: { name: 'sh', slug: 'sh' }, ...o })).id)
    const conn = (
      await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })
    ).id
    await payload.update({
      collection: 'workspaces',
      id: ws,
      data: { knowledgeConnection: conn, knowledgeRepo: REPO },
      ...o,
    })
    const add = async (slug: string, repo: string) => {
      const product = (
        await payload.create({ collection: 'products', data: { name: slug, slug, workspace: ws }, ...o })
      ).id
      await payload.create({ collection: 'repositories', data: { fullName: repo, product, workspace: ws }, ...o })
      await payload.create({
        collection: 'ticket_sources',
        data: { repo, product, connection: conn, cursor: '2026-10-30T09:00:00Z', workspace: ws },
        ...o,
      })
    }
    await add('s1', 'acme/shared')
    await add('s2', 'acme/shared')
    await add('s3', REPO)
    await knowledge.resync(payload, ws)
    expect(await knowledge.resync(payload, ws)).toBe(false)
    const count = async (q: string) =>
      Number(
        (
          await payload.db.drizzle.execute(
            sql`SELECT count(*) AS n FROM "knowledge_chunks" WHERE "workspace_id" = ${ws} AND ${sql.raw(q)}`,
          )
        ).rows[0].n,
      )
    expect(await count(`"source" LIKE 'acme/shared#%'`)).toBe(2)
    expect(await count(`"source" = '${REPO}'`)).toBeGreaterThan(0)
    expect(await count(`"source" LIKE '${REPO}#%'`)).toBe(0)
    expect(
      (
        await payload.db.drizzle.execute(
          sql`SELECT DISTINCT "source" FROM "knowledge_chunks" WHERE "workspace_id" = ${ws} AND "path" = 'handbook.md'`,
        )
      ).rows,
    ).toHaveLength(1)
  })
})
