import type { Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeBackend, MergePendingError } from '@bauherr/adapters'
import { createTestDb, type TestDb } from './helpers/test-db'

const backend = vi.hoisted(() => ({ current: null as unknown as FakeBackend }))
vi.mock('../src/lib/adapters', () => ({ backendFor: () => backend.current }))

const REPO = 'acme/knowledge'
const PATH = 'workspace/rules/style.md'
const o = { overrideAccess: true } as const
let payload: Payload
let edit: typeof import('../src/lib/knowledge-edit')
let member: Record<string, any>
let outsider: Record<string, any>
let ws: number

const forge = () => backend.current.forge
const editPrs = async () => (await forge().listPullRequests(REPO, 'all')).filter((p) => p.head.startsWith('bauherr/edit-'))
const sha = async () => (await forge().getFile(REPO, PATH)).sha
const save = (content: string, baseSha: string, path = PATH) => edit.saveDocument(payload, member, { workspace: ws, path, content, baseSha })
const green = async (n: number) => forge().listPullRequests(REPO).then((l) => backend.current.setChecks(REPO, l.find((p) => p.number === n)!.headSha, [{ name: 'lint', status: 'completed', conclusion: 'success' }]))

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('knowledge_edit_152')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  edit = await import('../src/lib/knowledge-edit')
  ws = Number((await payload.create({ collection: 'workspaces', data: { name: 'a', slug: 'a' }, ...o })).id)
  const other = Number((await payload.create({ collection: 'workspaces', data: { name: 'b', slug: 'b' }, ...o })).id)
  const conn = await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o } as never)
  await payload.update({ collection: 'workspaces', id: ws, data: { knowledgeConnection: conn.id, knowledgeRepo: REPO }, ...o })
  member = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
  outsider = await payload.create({ collection: 'bauherren', data: { email: 'out@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: other }] }, ...o })
})

beforeEach(() => {
  backend.current = new FakeBackend()
  backend.current.commit(REPO, 'main', PATH, '# Style\n\nKeep it short.\n')
  backend.current.commit(REPO, 'main', 'image.png', 'binary')
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

describe('saveDocument', () => {
  it('opens a PR with the edit, a co-author trailer and a human touch', async () => {
    const r = await save('# Style\n\nKeep it very short.\n', await sha())
    expect(r).toEqual({ pr: { number: 1, url: expect.stringContaining('/pull/1') } })
    const [pr] = await editPrs()
    expect(pr).toMatchObject({ state: 'open', base: 'main', title: `Edit ${PATH}` })
    expect(pr!.body).toContain('Co-authored-by: m <m@x.io>')
    expect((await forge().getFile(REPO, PATH, pr!.head)).content).toBe('# Style\n\nKeep it very short.\n')
    expect((await forge().getFile(REPO, PATH)).content).toBe('# Style\n\nKeep it short.\n')
    expect(await payload.count({ collection: 'human_touches', where: { kind: { equals: 'knowledge-edit' }, actor: { equals: 'm@x.io' } }, ...o })).toMatchObject({ totalDocs: 1 })
  })

  it('refuses a stale save with a diff and writes nothing', async () => {
    const base = await sha()
    backend.current.commit(REPO, 'main', PATH, '# Style\n\nKeep it tiny.\n')
    const r = await save('# Style\n\nKeep it very short.\n', base)
    expect(r).toEqual({ stale: { sha: await sha(), diff: '  # Style\n  \n- Keep it tiny.\n+ Keep it very short.\n  ' } })
    expect(await editPrs()).toEqual([])
  })

  it('refuses non-markdown, path escapes, a no-op and a Workspace the Bauherr is not in', async () => {
    const base = await sha()
    await expect(save('x', base, 'image.png')).rejects.toBeInstanceOf(edit.EditRefused)
    await expect(save('x', base, '../secrets.md')).rejects.toBeInstanceOf(edit.EditRefused)
    await expect(save('# Style\n\nKeep it short.\n', base)).rejects.toThrow('No changes')
    await expect(edit.saveDocument(payload, outsider, { workspace: ws, path: PATH, content: 'x', baseSha: base })).rejects.toThrow('Workspace not found')
    expect(await editPrs()).toEqual([])
  })
})

describe('watchKnowledgePrs', () => {
  const edited = async () => {
    const r = (await save('# Style\n\nKeep it very short.\n', await sha())) as { pr: { number: number } }
    return r.pr.number
  }

  it('merges once the checks are green, not before', async () => {
    const n = await edited()
    const [pr] = await editPrs()
    backend.current.setChecks(REPO, pr!.headSha, [{ name: 'lint', status: 'in_progress', conclusion: null }])
    expect(await edit.watchKnowledgePrs(payload)).toBe(0)
    await green(n)
    expect(await edit.watchKnowledgePrs(payload)).toBe(1)
    expect((await forge().getPullRequest(REPO, n)).state).toBe('merged')
  })

  it('does not merge red checks and comments once', async () => {
    const n = await edited()
    const [pr] = await editPrs()
    backend.current.setChecks(REPO, pr!.headSha, [{ name: 'lint', status: 'completed', conclusion: 'failure' }])
    expect(await edit.watchKnowledgePrs(payload)).toBe(0)
    expect(await edit.watchKnowledgePrs(payload)).toBe(0)
    expect((await forge().getPullRequest(REPO, n)).state).toBe('open')
    expect((await forge().listPullRequestComments(REPO, n)).filter((c) => c.body.startsWith(edit.CHECKS_FAILED))).toHaveLength(1)
  })

  it('leaves PRs that are not editor PRs alone and waits on a pending merge', async () => {
    await forge().createBranch(REPO, 'bauherr/7-1')
    backend.current.commit(REPO, 'bauherr/7-1', 'x.md', 'x')
    const other = await forge().openPullRequest(REPO, { title: 'factory', head: 'bauherr/7-1', base: 'main' })
    backend.current.setChecks(REPO, other.headSha, [{ name: 'lint', status: 'completed', conclusion: 'success' }])
    const n = await edited()
    await green(n)
    vi.spyOn(forge(), 'mergePullRequest').mockRejectedValueOnce(new MergePendingError('later'))
    expect(await edit.watchKnowledgePrs(payload)).toBe(0)
    expect((await forge().getPullRequest(REPO, other.number)).state).toBe('open')
    expect(await editPrs()).toHaveLength(1)
  })

  it('recreates a conflicting PR once, then flags it as needs-you', async () => {
    const n = await edited()
    await green(n)
    const merge = vi.spyOn(forge(), 'mergePullRequest').mockRejectedValue(new Error('not mergeable'))
    expect(await edit.watchKnowledgePrs(payload)).toBe(0)
    const prs = await editPrs()
    expect(prs.map((p) => p.state)).toEqual(['closed', 'open'])
    const second = prs[1]!
    expect(second.body).toContain(edit.REBASED)
    expect((await forge().getFile(REPO, PATH, second.head)).content).toBe('# Style\n\nKeep it very short.\n')
    expect((await forge().listPullRequestComments(REPO, n)).some((c) => c.body.startsWith(edit.SUPERSEDED))).toBe(true)

    await green(second.number)
    await edit.watchKnowledgePrs(payload)
    await edit.watchKnowledgePrs(payload)
    expect(await editPrs()).toHaveLength(2)
    expect((await forge().listPullRequestComments(REPO, second.number)).filter((c) => c.body.startsWith(edit.NEEDS_YOU))).toHaveLength(1)
    expect(merge).toHaveBeenCalledTimes(2)
  })

  it('re-applies the edit on top of a non-overlapping change on main when recreating', async () => {
    const n = await edited()
    await green(n)
    backend.current.commit(REPO, 'main', PATH, '# Style\n\nKeep it short.\n\nFooter.\n')
    vi.spyOn(forge(), 'mergePullRequest').mockRejectedValue(new Error('not mergeable'))
    await edit.watchKnowledgePrs(payload)
    const [, second] = await editPrs()
    expect((await forge().getFile(REPO, PATH, second!.head)).content).toBe('# Style\n\nKeep it very short.\n\nFooter.\n')
    expect((await forge().getPullRequest(REPO, n)).state).toBe('closed')
  })

  it('flags needs-you with the diff when the same region changed on main, and writes nothing', async () => {
    const n = await edited()
    await green(n)
    backend.current.commit(REPO, 'main', PATH, '# Style\n\nKeep it tiny.\n')
    vi.spyOn(forge(), 'mergePullRequest').mockRejectedValue(new Error('not mergeable'))
    await edit.watchKnowledgePrs(payload)
    await edit.watchKnowledgePrs(payload)
    expect(await editPrs()).toHaveLength(1)
    expect((await forge().getFile(REPO, PATH)).content).toBe('# Style\n\nKeep it tiny.\n')
    const needs = (await forge().listPullRequestComments(REPO, n)).filter((c) => c.body.startsWith(edit.NEEDS_YOU))
    expect(needs).toHaveLength(1)
    expect(needs[0]!.body).toContain('- Keep it tiny.\n+ Keep it very short.')
  })

  it('never merges a bauherr/edit-* PR the factory did not record, nor one whose head moved', async () => {
    await forge().createBranch(REPO, 'bauherr/edit-evil')
    backend.current.commit(REPO, 'bauherr/edit-evil', '.github/workflows/x.yml', 'run: evil')
    const evil = await forge().openPullRequest(REPO, { title: 'evil', head: 'bauherr/edit-evil', base: 'main' })
    await green(evil.number)
    const n = await edited()
    await green(n)
    backend.current.commit(REPO, (await forge().getPullRequest(REPO, n)).head, '.github/workflows/y.yml', 'run: evil')
    await green(n)
    expect(await edit.watchKnowledgePrs(payload)).toBe(0)
    expect((await forge().getPullRequest(REPO, evil.number)).state).toBe('open')
    expect((await forge().getPullRequest(REPO, n)).state).toBe('open')
  })
})

describe('merge3', () => {
  it('merges distant changes and refuses overlapping or adjacent ones', () => {
    expect(edit.merge3('a\nb\nc\nd', 'x\nb\nc\nd', 'a\nb\nc\ny')).toBe('x\nb\nc\ny')
    expect(edit.merge3('a\nb\nc', 'a\nx\nc', 'a\ny\nc')).toBeNull()
    expect(edit.merge3('a\nb\nc', 'x\nb\nc', 'a\ny\nc')).toBeNull()
  })
})

describe('lineDiff', () => {
  it('marks removed and added lines', () => {
    expect(edit.lineDiff('a\nb\nc', 'a\nx\nc')).toBe('  a\n- b\n+ x\n  c')
  })
})
