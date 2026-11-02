import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { FakeBackend } from '@bauherr/adapters'

const backend = vi.hoisted(() => ({ current: null as unknown as FakeBackend }))
vi.mock('../src/lib/adapters', () => ({ backendFor: () => backend.current }))

const REPO = 'acme/knowledge'
const o = { overrideAccess: true } as const
let payload: Payload
let page: typeof import('../src/app/(app)/lib/knowledge')
let withRepo: number
let withoutRepo: number

beforeAll(async () => {
  const pack = mkdtempSync(join(tmpdir(), 'pack-'))
  mkdirSync(join(pack, 'rules'))
  writeFileSync(join(pack, 'rules/evidence.md'), '# Evidence\n\nEvery MR carries zebra proof.\n')
  process.env.BAUHERR_PACK_DIR = pack
  backend.current = new FakeBackend()
  backend.current.commit(REPO, 'main', 'handbook.md', '# Handbook\n\nRead <script>alert(1)</script> **carefully** about giraffes.\n')
  backend.current.commit(REPO, 'main', 'image.png', 'giraffe binary')
  backend.current.forge.createBranch(REPO, 'bauherr/7')
  const head = backend.current.commit(REPO, 'bauherr/7', 'lessons.md', '# Lessons\n')
  backend.current.forge.createBranch(REPO, 'feature/x')
  await backend.current.forge.openPullRequest(REPO, { title: 'Write back', head: 'bauherr/7', base: 'main' })
  await backend.current.forge.openPullRequest(REPO, { title: 'Unrelated', head: 'feature/x', base: 'main' })
  backend.current.setChecks(REPO, head, [{ name: 'lint', status: 'completed', conclusion: 'failure' }])

  const base = process.env.DATABASE_URL ?? 'postgres://bauherr:bauherr@127.0.0.1:54330/bauherr'
  const admin = new pg.Client({ connectionString: base })
  await admin.connect()
  await admin.query('DROP DATABASE IF EXISTS bauherr_test_knowledge_page_151 WITH (FORCE)')
  await admin.query('CREATE DATABASE bauherr_test_knowledge_page_151')
  await admin.end()
  process.env.DATABASE_URL = base.replace(/\/[^/]+$/, '/bauherr_test_knowledge_page_151')
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  page = await import('../src/app/(app)/lib/knowledge')
  withoutRepo = Number((await payload.create({ collection: 'workspaces', data: { name: 'b', slug: 'b' }, ...o })).id)
  withRepo = Number((await payload.create({ collection: 'workspaces', data: { name: 'a', slug: 'a' }, ...o })).id)
  const conn = await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: withRepo }, ...o } as never)
  await payload.update({ collection: 'workspaces', id: withRepo, data: { knowledgeConnection: conn.id, knowledgeRepo: REPO }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
})

describe('loadKnowledge', () => {
  it('lists markdown documents per source, core pack first', async () => {
    const k = await page.loadKnowledge(withRepo, undefined, undefined)
    expect(k.sources.map((s) => [s.name, s.docs.map((d) => d.path)])).toEqual([['core', ['rules/evidence.md']], [REPO, ['handbook.md']]])
    expect(k.hits).toBeNull()
    expect(k.doc).toBeNull()
  })

  it('searches with citations and renders a document with raw HTML escaped', async () => {
    const hit = (await page.loadKnowledge(withRepo, 'giraffes', undefined)).hits![0]!
    expect(hit).toMatchObject({ source: REPO, path: 'handbook.md', heading: 'Handbook' })
    const { doc } = await page.loadKnowledge(withRepo, undefined, page.docKey(hit))
    expect(doc!.html).toContain('<strong>carefully</strong>')
    expect(doc!.html).not.toContain('<script>')
  })

  it('ignores a document that is not indexed, and does not read across Workspaces', async () => {
    expect((await page.loadKnowledge(withRepo, undefined, `${REPO}:missing.md`)).doc).toBeNull()
    const other = await page.loadKnowledge(withoutRepo, 'giraffes', `${REPO}:handbook.md`)
    expect(other.hits).toEqual([])
    expect(other.doc).toBeNull()
    expect(other.sources.map((s) => s.name)).toEqual(['core'])
  })

  it('lists only open bauherr/* PRs with their merge-gate checks; none without a Knowledge repo', async () => {
    expect((await page.loadKnowledge(withRepo, undefined, undefined)).writeBacks).toEqual([
      expect.objectContaining({ title: 'Write back', head: 'bauherr/7', checks: 'red', failed: ['lint'] }),
    ])
    expect((await page.loadKnowledge(withoutRepo, undefined, undefined)).writeBacks).toEqual([])
  })

  it('degrades to null when the forge fails', async () => {
    const prs = backend.current.forge.listPullRequests
    backend.current.forge.listPullRequests = async () => { throw new Error('down') }
    expect((await page.loadKnowledge(withRepo, undefined, undefined)).writeBacks).toBeNull()
    backend.current.forge.listPullRequests = prs
  })
})

describe('parseDocKey', () => {
  it('splits at the first colon and rejects malformed keys', () => {
    expect(page.parseDocKey('acme/kb:a/b:c.md')).toEqual({ source: 'acme/kb', path: 'a/b:c.md' })
    for (const bad of [undefined, '', 'x', ':a.md', 'core:']) expect(page.parseDocKey(bad)).toBeNull()
  })
})
