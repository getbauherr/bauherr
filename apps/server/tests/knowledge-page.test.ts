import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { FakeBackend } from '@bauherr/adapters'
import { createTestDb, type TestDb } from './helpers/test-db'

const backend = vi.hoisted(() => ({ current: null as unknown as FakeBackend }))
vi.mock('../src/lib/adapters', () => ({ backendFor: () => backend.current }))

const REPO = 'acme/knowledge'
const o = { overrideAccess: true } as const
let payload: Payload
let page: typeof import('../src/app/(app)/lib/knowledge')
let withRepo: number
let withoutRepo: number

const admin = { admin: true }
const member = { admin: false }
let testDb: TestDb
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

  testDb = await createTestDb('knowledge_page_151')
  process.env.DATABASE_URL = testDb.url
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
  await testDb?.drop(payload)
})

describe('loadKnowledge', () => {
  it('lists markdown documents per source, core pack first', async () => {
    const k = await page.loadKnowledge(withRepo, undefined, undefined, admin)
    expect(k.sources.map((s) => [s.name, s.label, s.docs.map((d) => [d.path, d.title])])).toEqual([['core', 'Built-in', [['rules/evidence.md', 'Evidence']]], [REPO, 'Your Knowledge', [['handbook.md', 'Handbook']]]])
    expect(k.hits).toBeNull()
    expect(k.doc).toBeNull()
  })

  it('searches with citations and renders a document with raw HTML escaped', async () => {
    const hit = (await page.loadKnowledge(withRepo, 'giraffes', undefined, admin)).hits![0]!
    expect(hit).toMatchObject({ source: REPO, path: 'handbook.md', heading: 'Handbook' })
    const { doc } = await page.loadKnowledge(withRepo, undefined, page.docKey(hit), admin)
    expect(doc!.html).toContain('<strong>carefully</strong>')
    expect(doc!.html).not.toContain('<script>')
  })

  it('ignores a document that is not indexed, and does not read across Workspaces', async () => {
    expect((await page.loadKnowledge(withRepo, undefined, `${REPO}:missing.md`, admin)).doc).toBeNull()
    const other = await page.loadKnowledge(withoutRepo, 'giraffes', `${REPO}:handbook.md`, admin)
    expect(other.hits).toEqual([])
    expect(other.doc).toBeNull()
    expect(other.sources.map((s) => s.name)).toEqual(['core'])
  })

  it('lists only open bauherr/* PRs with their merge-gate checks; none without a Knowledge repo', async () => {
    expect((await page.loadKnowledge(withRepo, undefined, undefined, admin)).writeBacks).toEqual([
      expect.objectContaining({ title: 'Write back', head: 'bauherr/7', checks: 'red', failed: ['lint'] }),
    ])
    expect((await page.loadKnowledge(withoutRepo, undefined, undefined, admin)).writeBacks).toEqual([])
  })

  it('degrades to null when the forge fails', async () => {
    const prs = backend.current.forge.listPullRequests
    backend.current.forge.listPullRequests = async () => { throw new Error('down') }
    expect((await page.loadKnowledge(withRepo, undefined, undefined, admin)).writeBacks).toBeNull()
    backend.current.forge.listPullRequests = prs
  })
})

describe('loadKnowledge for a member', () => {
  it('hides the core pack in the list, in search and as a document; reads no write-backs from the forge', async () => {
    const listPullRequests = vi.spyOn(backend.current.forge, 'listPullRequests')
    const k = await page.loadKnowledge(withRepo, 'zebra', 'core:rules/evidence.md', member)
    expect(k.sources.map((s) => s.name)).toEqual([REPO])
    expect(k.hits).toEqual([])
    expect(k.doc).toBeNull()
    expect(k.writeBacks).toBeNull()
    expect(listPullRequests).not.toHaveBeenCalled()
    listPullRequests.mockRestore()
  })
})

describe('title', () => {
  it('prefers the heading, else de-dashes the file name', () => {
    expect(page.title('docs/x.md', ' Release policy ')).toBe('Release policy')
    expect(page.title('handbook/release-policy.md', '')).toBe('Release policy')
    expect(page.title('notes_v2.md')).toBe('Notes v2')
  })
})

describe('parseDocKey', () => {
  it('splits at the first colon and rejects malformed keys', () => {
    expect(page.parseDocKey('acme/kb:a/b:c.md')).toEqual({ source: 'acme/kb', path: 'a/b:c.md' })
    for (const bad of [undefined, '', 'x', ':a.md', 'core:']) expect(page.parseDocKey(bad)).toBeNull()
  })
})
