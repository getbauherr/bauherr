import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { FakeBackend } from '@bauherr/adapters'
import { createTestDb, type TestDb } from './helpers/test-db'

const backend = vi.hoisted(() => ({ current: null as unknown as FakeBackend }))
vi.mock('../src/lib/adapters', () => ({ backendFor: () => backend.current }))

const REPO = 'acme/knowledge'
const o = { overrideAccess: true } as const
let payload: Payload
let knowledge: typeof import('../src/lib/knowledge')
let withRepo: number
let withoutRepo: number

let testDb: TestDb
beforeAll(async () => {
  const pack = mkdtempSync(join(tmpdir(), 'pack-'))
  mkdirSync(join(pack, 'rules'))
  writeFileSync(join(pack, 'rules/evidence.md'), '# Evidence\n\nEvery MR carries zebra proof.\n')
  writeFileSync(join(pack, 'rules/style.md'), '# Style\n\nKeep it short.\n')
  process.env.BAUHERR_PACK_DIR = pack
  backend.current = new FakeBackend()
  backend.current.commit(REPO, 'main', 'workspace/rules/evidence.md', '# Evidence\n\nHouse rule: giraffe proof.\n')
  backend.current.commit(REPO, 'main', 'products/web/notes.md', '# Notes\n\nWeb only okapi note.\n')
  backend.current.commit(REPO, 'main', 'products/api/notes.md', '# Notes\n\nApi only okapi note.\n')
  backend.current.commit(REPO, 'main', 'handbook.md', '# Handbook\n\nokapi okapi okapi okapi\n\n## Other\n\nokapi\n')
  backend.current.commit(REPO, 'main', 'image.png', 'okapi binary')

  testDb = await createTestDb('knowledge_150')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  knowledge = await import('../src/lib/knowledge')
  withoutRepo = Number((await payload.create({ collection: 'workspaces', data: { name: 'b', slug: 'b' }, ...o })).id)
  const a = Number((await payload.create({ collection: 'workspaces', data: { name: 'a', slug: 'a' }, ...o })).id)
  const conn = await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: a }, ...o } as never)
  await payload.update({ collection: 'workspaces', id: a, data: { knowledgeConnection: conn.id, knowledgeRepo: REPO }, ...o })
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
  it('finds the core pack without a Knowledge repo, with a citation', async () => {
    const hits = await knowledge.search(payload, withoutRepo, 'zebra')
    expect(hits).toEqual([expect.objectContaining({ source: 'core', path: 'rules/evidence.md', heading: 'Evidence', commit: 'core-pack' })])
  })

  it('finds a repo document with source, path, heading and commit, and skips non-markdown files', async () => {
    const hits = await knowledge.search(payload, withRepo, 'giraffe')
    expect(hits).toEqual([expect.objectContaining({ source: REPO, path: 'workspace/rules/evidence.md', heading: 'Evidence', commit: expect.any(String) })])
    expect(hits[0]!.commit).not.toBe('core-pack')
    expect((await knowledge.search(payload, withRepo, 'binary')).length).toBe(0)
  })

  it('a later layer shadows the earlier one at the same logical path', async () => {
    expect((await knowledge.search(payload, withRepo, 'zebra')).length).toBe(0)
    expect((await knowledge.read(payload, withRepo, 'rules/evidence.md'))?.text).toContain('giraffe')
    expect((await knowledge.read(payload, withoutRepo, 'rules/evidence.md'))?.text).toContain('zebra')
  })

  it('shows a product layer only to that product', async () => {
    const all = (p?: string) => knowledge.search(payload, withRepo, 'okapi note', 20, p).then((h) => h.map((x) => x.path))
    expect(await all()).toEqual([])
    expect(await all('web')).toEqual(['products/web/notes.md'])
  })

  it('ranks the better match first', async () => {
    const hits = await knowledge.search(payload, withRepo, 'okapi')
    expect(hits[0]).toMatchObject({ path: 'handbook.md', heading: 'Handbook' })
  })

  it('never returns another Workspace documents', async () => {
    expect(await knowledge.search(payload, withoutRepo, 'giraffe')).toEqual([])
    expect(await knowledge.read(payload, withoutRepo, 'handbook.md')).toBeNull()
  })
})

describe('resync', () => {
  it('re-indexes only when the default-branch commit changed', async () => {
    const getFile = vi.spyOn(backend.current.forge, 'getFile')
    expect(await knowledge.resync(payload, withRepo)).toBe(false)
    expect(getFile).not.toHaveBeenCalled()

    backend.current.commit(REPO, 'main', 'handbook.md', '# Handbook\n\nnarwhal arrives\n')
    expect(await knowledge.resync(payload, withRepo)).toBe(true)
    expect(getFile).toHaveBeenCalled()
    const hits = await knowledge.search(payload, withRepo, 'narwhal')
    expect(hits[0]).toMatchObject({ path: 'handbook.md', source: REPO })
    expect((await knowledge.search(payload, withRepo, 'okapi okapi')).map((h) => h.path)).not.toContain('handbook.md')
    expect(await knowledge.resync(payload, withRepo)).toBe(false)
  })

  it('keeps the old index when the forge fails and drops it when the repo is unset', async () => {
    backend.current.commit(REPO, 'main', 'extra.md', '# Extra\n\nquokka\n')
    const fail = vi.spyOn(backend.current.forge, 'listFiles').mockRejectedValueOnce(new Error('down'))
    expect(await knowledge.resync(payload, withRepo)).toBe(false)
    fail.mockRestore()
    expect((await knowledge.search(payload, withRepo, 'narwhal')).length).toBe(1)

    await payload.update({ collection: 'workspaces', id: withRepo, data: { knowledgeRepo: null }, ...o })
    expect(await knowledge.resync(payload, withRepo)).toBe(true)
    expect(await knowledge.search(payload, withRepo, 'narwhal')).toEqual([])
    expect((await knowledge.search(payload, withRepo, 'Keep it short')).length).toBe(1)
  })
})

describe('MCP tools', () => {
  it('search_knowledge returns citations and read_knowledge resolves layers for the callers Workspace', async () => {
    const { callTool } = await import('../src/lib/mcp-tools')
    const ctx = (workspace: number) => ({ payload, user: { role: 'bauherr', tenants: [{ tenant: workspace }] }, actor: { kind: 'human' as const } })
    const hits = (await callTool(ctx(withoutRepo), 'search_knowledge', { query: 'zebra' })) as Record<string, unknown>[]
    expect(hits[0]).toMatchObject({ source: 'core', path: 'rules/evidence.md', heading: 'Evidence', commit: 'core-pack' })
    expect(await callTool(ctx(withoutRepo), 'read_knowledge', { path: 'rules/evidence.md' })).toContain('zebra')
    expect(await callTool(ctx(withoutRepo), 'read_knowledge', { path: 'rules/style.md' })).toContain('Keep it short')
  })
})

describe('repo switch, failure back-off and fencing', () => {
  const OTHER = 'acme/other'
  let switched: number
  const makeWs = async (slug: string, repo: string) => {
    const w = Number((await payload.create({ collection: 'workspaces', data: { name: slug, slug }, ...o })).id)
    const conn = await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: w }, ...o } as never)
    await payload.update({ collection: 'workspaces', id: w, data: { knowledgeConnection: conn.id, knowledgeRepo: repo }, ...o })
    return w
  }

  it('switching knowledgeRepo A to B drops As chunks', async () => {
    backend.current.commit('acme/a', 'main', 'a.md', '# A\n\naardvark\n')
    backend.current.commit('acme/b', 'main', 'b.md', '# B\n\nbonobo\n')
    const w = (switched = await makeWs('switch', 'acme/a'))
    await knowledge.resync(payload, w)
    expect((await knowledge.search(payload, w, 'aardvark')).length).toBe(1)
    await payload.update({ collection: 'workspaces', id: w, data: { knowledgeRepo: 'acme/b' }, ...o })
    await knowledge.resync(payload, w)
    expect(await knowledge.search(payload, w, 'aardvark')).toEqual([])
    expect((await knowledge.search(payload, w, 'bonobo')).length).toBe(1)
  })

  it('does not refetch a failing repo until the back-off passed', async () => {
    backend.current.commit(OTHER, 'main', 'x.md', '# X\n\nx\n')
    const w = await makeWs('backoff', OTHER)
    const list = vi.spyOn(backend.current.forge, 'listFiles').mockRejectedValue(new Error('down'))
    await knowledge.resync(payload, w)
    await knowledge.resync(payload, w)
    expect(list).toHaveBeenCalledTimes(1)
    list.mockRestore()
  })

  it('fences repo text for agents and leaves core text plain', async () => {
    const { callTool } = await import('../src/lib/mcp-tools')
    const ctx = (workspace: number) => ({ payload, user: { role: 'bauherr', tenants: [{ tenant: workspace }] }, actor: { kind: 'human' as const } })
    const repoHits = (await callTool(ctx(switched), 'search_knowledge', { query: 'bonobo' })) as { text: string }[]
    expect(repoHits[0]!.text).toContain('<untrusted-data>')
    expect(await callTool(ctx(switched), 'read_knowledge', { path: 'b.md' })).toContain('<untrusted-data>')
    const core = (await callTool(ctx(withoutRepo), 'search_knowledge', { query: 'zebra' })) as { text: string }[]
    expect(core[0]!.text).not.toContain('untrusted-data')
  })
})

describe('Product docs', () => {
  let w: number
  let conn: number
  let PA: string
  let PB: string
  const ctx = (workspace: number) => ({ payload, user: { role: 'bauherr', tenants: [{ tenant: workspace }] }, actor: { kind: 'human' as const } })
  const addProduct = async (slug: string, repo: string) => {
    const product = (await payload.create({ collection: 'products', data: { name: slug, slug, workspace: w }, ...o } as never)).id
    await payload.create({ collection: 'repositories', data: { fullName: repo, product, workspace: w }, ...o } as never)
    await payload.create({ collection: 'ticket_sources', data: { repo, product, connection: conn, cursor: '2026-10-30T09:00:00Z', workspace: w }, ...o } as never)
    return product
  }
  const sources = async () => (await knowledge.documents(payload, w)).map((d) => `${d.source}:${d.path}`)

  beforeAll(async () => {
    const fb = backend.current
    fb.commit('acme/pa', 'main', 'README.md', '# Pa\n\nlemur readme\n')
    fb.commit('acme/pa', 'main', 'docs/guide/setup.md', '# Setup\n\nlemur setup\n')
    fb.commit('acme/pa', 'main', 'docs/logo.png', 'lemur binary')
    fb.commit('acme/pa', 'main', 'src/notes.md', '# Notes\n\nlemur outside docs\n')
    fb.commit('acme/pb', 'main', 'README.md', '# Pb\n\nmeerkat readme\n')
    fb.commit('acme/pa', 'main', 'docs/evidence.md', '# Evidence\n\nlemur shadow try\n')
    w = Number((await payload.create({ collection: 'workspaces', data: { name: 'pd', slug: 'pd' }, ...o })).id)
    conn = Number((await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: w }, ...o } as never)).id)
    PA = `acme/pa#${await addProduct('pa', 'acme/pa')}`
    PB = `acme/pb#${await addProduct('pb', 'acme/pb')}`
    expect(await knowledge.resync(payload, w)).toBe(true)
  })

  it('indexes README and docs with source, layer, product and logical path', async () => {
    expect(await sources()).toEqual(expect.arrayContaining([`${PA}:README.md`, `${PA}:docs/guide/setup.md`, `${PB}:README.md`]))
    expect(await sources()).not.toContain(`${PA}:src/notes.md`)
    const r = await payload.db.drizzle.execute(sql`SELECT "layer", "product", "logical" FROM "knowledge_chunks" WHERE "workspace_id" = ${w} AND "source" = ${PA} AND "path" = 'docs/guide/setup.md'`)
    expect(r.rows[0]).toEqual({ layer: 'product', product: 'pa', logical: 'repo-docs/docs/guide/setup.md' })
    expect(await knowledge.readDocument(payload, w, PA, 'README.md')).toContain('lemur readme')
  })

  it('shows a Product its own docs only', async () => {
    const paths = (p?: string, q = 'lemur OR meerkat') => knowledge.search(payload, w, q, 20, p).then((h) => h.map((x) => `${x.source}:${x.path}`).sort())
    expect(await paths('pa')).toEqual([`${PA}:README.md`, `${PA}:docs/evidence.md`, `${PA}:docs/guide/setup.md`])
    expect(await paths('pb')).toEqual([`${PB}:README.md`])
    expect(await paths()).toEqual([])
  })

  it('never shadows a core document', async () => {
    expect((await knowledge.read(payload, w, 'rules/evidence.md', 'pa'))?.text).toContain('zebra')
    expect((await knowledge.search(payload, w, 'zebra', 20, 'pa')).length).toBe(1)
  })

  it('fences product hits for agents', async () => {
    const { callTool } = await import('../src/lib/mcp-tools')
    const hits = (await callTool(ctx(w), 'search_knowledge', { query: 'meerkat', product: 'pb' })) as { source: string; text: string }[]
    expect(hits[0]).toMatchObject({ source: 'acme/pb' })
    expect(hits[0]!.text).toContain('<untrusted-data>')
    expect(await callTool(ctx(w), 'read_knowledge', { path: 'repo-docs/README.md', product: 'pb' })).toContain('<untrusted-data>')
  })

  it('re-indexes on a changed commit, not on an unchanged one', async () => {
    const getFile = vi.spyOn(backend.current.forge, 'getFile')
    expect(await knowledge.resync(payload, w)).toBe(false)
    expect(getFile).not.toHaveBeenCalled()
    backend.current.commit('acme/pb', 'main', 'docs/new.md', '# New\n\nmeerkat novelty\n')
    expect(await knowledge.resync(payload, w)).toBe(true)
    expect((await knowledge.search(payload, w, 'novelty', 20, 'pb')).length).toBe(1)
    expect(getFile.mock.calls.every(([repo]) => repo === 'acme/pb')).toBe(true)
    getFile.mockRestore()
  })

  it('keeps the old index of a failing repo and backs off', async () => {
    backend.current.commit('acme/pa', 'main', 'docs/more.md', '# More\n\nlemur more\n')
    const list = vi.spyOn(backend.current.forge, 'listFiles').mockImplementation(async (repo: string) => {
      if (repo === 'acme/pa') throw new Error('down')
      return { commit: 'x', paths: [], truncated: false } as never
    })
    await knowledge.resync(payload, w)
    await knowledge.resync(payload, w)
    expect(list.mock.calls.filter(([repo]) => repo === 'acme/pa')).toHaveLength(1)
    list.mockRestore()
    expect(await sources()).toContain(`${PA}:README.md`)
    expect(await sources()).not.toContain(`${PA}:docs/more.md`)
  })

  it('drops the chunks of a removed Product', async () => {
    const pb = (await payload.find({ collection: 'products', where: { slug: { equals: 'pb' }, workspace: { equals: w } }, ...o } as never)).docs[0]!
    for (const c of ['ticket_sources', 'repositories'] as const) await payload.delete({ collection: c, where: { product: { equals: pb.id } }, ...o } as never)
    await payload.delete({ collection: 'products', id: pb.id, ...o })
    expect(await knowledge.resync(payload, w)).toBe(true)
    expect((await sources()).filter((s) => s.startsWith(PB))).toEqual([])
    expect((await sources())).toContain(`${PA}:README.md`)
  })
})

describe('Product docs sharing a repo', () => {
  it('keeps both Products chunks, and skips a Product on the Knowledge repo', async () => {
    const fb = backend.current
    fb.commit('acme/shared', 'main', 'README.md', '# Shared\n\nnarwhal readme\n')
    const ws = Number((await payload.create({ collection: 'workspaces', data: { name: 'sh', slug: 'sh' }, ...o })).id)
    const conn = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o } as never)).id
    await payload.update({ collection: 'workspaces', id: ws, data: { knowledgeConnection: conn, knowledgeRepo: REPO }, ...o })
    const add = async (slug: string, repo: string) => {
      const product = (await payload.create({ collection: 'products', data: { name: slug, slug, workspace: ws }, ...o } as never)).id
      await payload.create({ collection: 'repositories', data: { fullName: repo, product, workspace: ws }, ...o } as never)
      await payload.create({ collection: 'ticket_sources', data: { repo, product, connection: conn, cursor: '2026-10-30T09:00:00Z', workspace: ws }, ...o } as never)
    }
    await add('s1', 'acme/shared')
    await add('s2', 'acme/shared')
    await add('s3', REPO)
    await knowledge.resync(payload, ws)
    expect(await knowledge.resync(payload, ws)).toBe(false)
    const count = async (q: string) => Number((await payload.db.drizzle.execute(sql`SELECT count(*) AS n FROM "knowledge_chunks" WHERE "workspace_id" = ${ws} AND ${sql.raw(q)}`)).rows[0]!.n)
    expect(await count(`"source" LIKE 'acme/shared#%'`)).toBe(2)
    expect(await count(`"source" = '${REPO}'`)).toBeGreaterThan(0)
    expect(await count(`"source" LIKE '${REPO}#%'`)).toBe(0)
    expect((await knowledge.documents(payload, ws)).filter((d) => d.path === 'handbook.md')).toHaveLength(1)
  })
})
