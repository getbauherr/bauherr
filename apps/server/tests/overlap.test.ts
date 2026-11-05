import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PLAN_MARKER } from '../src/app/(app)/lib/plan'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let fake: FakeBackend
let ws: number
let product: number
let user: Record<string, any>
let actions: typeof import('../src/lib/actions')
let jobs: typeof import('../src/jobs')
let wip: typeof import('../src/lib/wip')
let overlap: typeof import('../src/lib/overlap')
const o = { overrideAccess: true } as const
let repo = ''
let connection: number
let n = 0

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('overlap_277')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  delete process.env.BAUHERR_PACK_DIR
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  actions = await import('../src/lib/actions')
  jobs = await import('../src/jobs')
  wip = await import('../src/lib/wip')
  overlap = await import('../src/lib/overlap')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  user = await payload.create({ collection: 'bauherren', data: { email: 'a@x.io', password: 'pw-123456', role: 'admin' }, ...o })
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', wipLimits: {} }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

beforeEach(async () => {
  delete process.env.BAUHERR_PACK_DIR
  await payload.update({ collection: 'products', id: product, data: { overlapIgnore: [] }, ...o })
  await payload.delete({ collection: 'runs', where: { workspace: { equals: ws } }, ...o })
  await payload.delete({ collection: 'tickets', where: { workspace: { equals: ws } }, ...o })
  await payload.delete({ collection: 'ticket_sources', where: { workspace: { equals: ws } }, ...o })
  repo = `acme/ovl-${++n}`
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
})

const poll = () => (jobs.pollTickets.handler as (a: unknown) => Promise<unknown>)({ req: { payload } })
const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>
const runs = async (id: number, stage: string) => (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: id } }, { stage: { equals: stage } }] }, ...o })).docs

const plan = (files?: string[]) => `## Goal\n- Ship it\n\n## Steps\n1. Do it${files ? `\n\n## Files\n${files.map((f) => `- ${f}`).join('\n')}` : ''}`

/** An open Ticket in `stage` with a plan declaring `files` (none: no `## Files`); a plan Ticket gets a succeeded plan Run, a build Ticket a plain plan Comment. */
const ticket = async (title: string, stage: 'plan' | 'build' | 'review', files?: string[], extra: Record<string, unknown> = {}, run: 'queued' | 'running' | 'needs_human' | 'none' = 'queued') => {
  const labels = [`bauherr:stage:${stage}`, ...(extra.bug ? ['type:bug'] : [])]
  delete extra.bug
  const issue = await fake.tickets(repo).create({ title, labels })
  const t = await payload.create({ collection: 'tickets', data: { title, externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage, labels, product, workspace: ws, rank: title, ...extra }, ...o })
  if (stage === 'plan') {
    await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'plan', status: 'succeeded', mode: 'autonomous', workspace: ws }, ...o })
    await actions.submitPlan(payload, user, { ticket: t.id as number, markdown: plan(files) })
  } else {
    await fake.tickets(repo).comment(String(issue.number), `${PLAN_MARKER}\n${plan(files)}`)
    // A Ticket in Build or Review has work in flight unless a test says otherwise.
    if (run !== 'none') await payload.create({ collection: 'runs', data: { ticket: t.id, stage, status: run, mode: 'autonomous', workspace: ws }, ...o })
  }
  return { id: t.id as number, n: issue.number }
}

/** A factory PR for the Ticket changing `files`, linked through a build Run. */
const withPr = async (t: { id: number; n: number }, files: string[], status: 'open' | 'merged' = 'open') => {
  const branch = `bauherr/${t.n}-x`
  await fake.forge.createBranch(repo, branch)
  for (const f of files) fake.commit(repo, branch, f, `// ${t.n}`)
  const pr = await fake.forge.openPullRequest(repo, { title: `t${t.n}`, head: branch, base: 'main' })
  if (status === 'merged') fake.merge(repo, pr.number)
  await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'build', status: 'succeeded', mode: 'autonomous', workspace: ws, artifacts: { prUrl: pr.url } }, ...o })
  return pr
}

it('globsIntersect: literal paths, glob against path, glob against glob by literal prefix', () => {
  const { globsIntersect } = overlap
  expect(globsIntersect('src/a.ts', 'src/a.ts')).toBe(true)
  expect(globsIntersect('src/a.ts', 'src/a.tsx')).toBe(false)
  expect(globsIntersect('src/**', 'src/app/page.tsx')).toBe(true)
  expect(globsIntersect('docs/*.md', 'src/readme.md')).toBe(false)
  expect(globsIntersect('src/app/**', 'src/**/*.ts')).toBe(true)
  expect(globsIntersect('src/app/**', 'docs/**')).toBe(false)
  expect(globsIntersect('**/*.md', 'a/b.md')).toBe(true)
})

describe('the Build hold', () => {
  it('a lower-ranked Build with intersecting plan paths waits with "overlaps #N" and no Run; the earlier merge releases it', async () => {
    const a = await ticket('a', 'build', ['src/app/**'])
    const b = await ticket('b', 'plan', ['src/app/page.tsx'])
    await poll()
    expect(await reload(b.id)).toMatchObject({ stage: 'plan', waitingFor: 'build', waitingReason: `overlaps #${a.n}` })
    expect(await runs(b.id, 'build')).toHaveLength(0)
    expect(await wip.waitingLabel(payload, await reload(b.id))).toBe(`Waiting: overlaps #${a.n}`)
    await poll()
    expect(await runs(b.id, 'build')).toHaveLength(0)

    await payload.update({ collection: 'tickets', id: a.id, data: { stage: 'release' }, ...o })
    await poll()
    expect(await reload(b.id)).toMatchObject({ stage: 'build', waitingFor: null, waitingReason: null })
    expect(await runs(b.id, 'build')).toHaveLength(1)
  })

  it('an earlier Ticket in review holds, and a held Ticket does not block disjoint ones', async () => {
    const r = await ticket('r', 'review', ['src/lib/x.ts'])
    const held = await ticket('b', 'plan', ['src/lib/x.ts'])
    const free = await ticket('c', 'plan', ['docs/readme.md'])
    await poll()
    expect(await reload(held.id)).toMatchObject({ stage: 'plan', waitingFor: 'build', waitingReason: `overlaps #${r.n}` })
    expect(await reload(free.id)).toMatchObject({ stage: 'build', waitingFor: null })
    expect(await runs(free.id, 'build')).toHaveLength(1)
  })

  it('a higher-ranked Ticket is never held by a lower-ranked one', async () => {
    await ticket('z', 'build', ['src/**'])
    const a = await ticket('a', 'plan', ['src/x.ts'])
    await poll()
    expect(await reload(a.id)).toMatchObject({ stage: 'build', waitingFor: null })
    expect(await runs(a.id, 'build')).toHaveLength(1)
  })

  it('a plan without ## Files holds nothing until its PR exists, then the actual PR files hold', async () => {
    const a = await ticket('a', 'build')
    const b = await ticket('b', 'plan', ['src/x.ts'])
    await poll()
    expect(await reload(b.id)).toMatchObject({ stage: 'build', waitingFor: null })

    await withPr(a, ['src/x.ts'])
    const c = await ticket('c', 'plan', ['src/x.ts'])
    await poll()
    expect(await reload(c.id)).toMatchObject({ stage: 'plan', waitingFor: 'build', waitingReason: `overlaps #${a.n}` })
    expect(await runs(c.id, 'build')).toHaveLength(0)
  })

  it('a Ticket without ## Files is not held even when the earlier one has paths', async () => {
    await ticket('a', 'build', ['src/**'])
    const b = await ticket('b', 'plan')
    await poll()
    expect(await reload(b.id)).toMatchObject({ stage: 'build', waitingFor: null })
  })

  it('overlapIgnore paths never hold', async () => {
    await payload.update({ collection: 'products', id: product, data: { overlapIgnore: ['CHANGELOG.md', 'src/gen/**'] }, ...o })
    await ticket('a', 'build', ['CHANGELOG.md', 'src/gen/a.ts'])
    const b = await ticket('b', 'plan', ['CHANGELOG.md', 'src/gen/b.ts'])
    await poll()
    expect(await reload(b.id)).toMatchObject({ stage: 'build', waitingFor: null })
  })

  it('a Ticket that left no longer overlaps once its paths are ignored: pullWaiting re-checks every poll', async () => {
    await ticket('a', 'build', ['pnpm-lock.yaml'])
    const b = await ticket('b', 'plan', ['pnpm-lock.yaml'])
    await poll()
    expect(await reload(b.id)).toMatchObject({ waitingFor: 'build' })
    await payload.update({ collection: 'products', id: product, data: { overlapIgnore: ['pnpm-lock.yaml'] }, ...o })
    await poll()
    expect(await reload(b.id)).toMatchObject({ stage: 'build', waitingFor: null })
    expect(await runs(b.id, 'build')).toHaveLength(1)
  })

  it('a return from release (request changes) is never held', async () => {
    await ticket('a', 'build', ['src/x.ts'])
    const b = await ticket('b', 'build', ['src/x.ts'], { stage: 'release', mergeSha: 'sha-1', releaseAt: new Date().toISOString(), releaseState: 'on_staging' })
    await actions.requestChanges(payload, user, { ticket: b.id, note: 'again' })
    expect(await reload(b.id)).toMatchObject({ stage: 'build', waitingFor: null })
    expect(await runs(b.id, 'build')).toHaveLength(1)
  })

  it('an earlier Build Ticket that waits on a human holds nothing, one with a running Run does', async () => {
    const idle = await ticket('a', 'build', ['src/x.ts'], {}, 'needs_human')
    const b = await ticket('b', 'plan', ['src/x.ts'])
    await poll()
    expect(await reload(b.id)).toMatchObject({ stage: 'build', waitingFor: null })

    await payload.update({ collection: 'tickets', id: b.id, data: { stage: 'plan', waitingFor: null }, ...o })
    await payload.update({ collection: 'tickets', id: idle.id, data: { stage: 'release' }, ...o })
    const a2 = await ticket('a2', 'build', ['src/y.ts'], {}, 'running')
    const c = await ticket('c', 'plan', ['src/y.ts'])
    await poll()
    expect(await reload(c.id)).toMatchObject({ stage: 'plan', waitingFor: 'build', waitingReason: `overlaps #${a2.n}` })
  })

  it('a bug goes before a feature that has not started, but not before one that is running', async () => {
    const feature = await ticket('a', 'build', ['src/x.ts'], {}, 'queued')
    const bug = await ticket('b', 'plan', ['src/x.ts'], { bug: true })
    await poll()
    expect(await reload(bug.id)).toMatchObject({ stage: 'build', waitingFor: null })
    expect(await runs(bug.id, 'build')).toHaveLength(1)

    await payload.update({ collection: 'tickets', id: feature.id, data: { stage: 'release' }, ...o })
    const running = await ticket('c', 'build', ['src/z.ts'], {}, 'running')
    const bug2 = await ticket('d', 'plan', ['src/z.ts'], { bug: true })
    await poll()
    expect(await reload(bug2.id)).toMatchObject({ stage: 'plan', waitingFor: 'build', waitingReason: `overlaps #${running.n}` })
  })

  it('a feature is held by a later-ranked bug in flight that shares paths, not by one that does not', async () => {
    const feature = await ticket('a', 'build', ['src/x.ts'], {}, 'none')
    await ticket('y', 'build', ['docs/y.md'], { bug: true }, 'running')
    expect(await overlap.holdOverlap(payload, await reload(feature.id))).toBe(false)
    const bug = await ticket('z', 'build', ['src/x.ts'], { bug: true }, 'running')
    expect(await overlap.holdOverlap(payload, await reload(feature.id))).toBe(true)
    expect(await reload(feature.id)).toMatchObject({ waitingFor: 'build', waitingReason: `overlaps #${bug.n}` })
  })

  it('a WIP wait clears a stale overlap reason', async () => {
    await payload.update({ collection: 'workspaces', id: ws, data: { wipLimits: { build: 1 } }, ...o })
    await ticket('a', 'build', ['docs/a.md'])
    const b = await ticket('b', 'plan', ['src/b.ts'], { waitingFor: 'build', waitingReason: 'overlaps #99' })
    await poll()
    expect(await reload(b.id)).toMatchObject({ stage: 'plan', waitingFor: 'build', waitingReason: null })
    expect(await wip.waitingLabel(payload, await reload(b.id))).toBe('Waiting: Build is full (1/1)')
    await payload.update({ collection: 'workspaces', id: ws, data: { wipLimits: {} }, ...o })
  })
})

describe('suggestOverlapIgnore', () => {
  it('returns files changed in at least 25% of the merged PRs and nothing below', async () => {
    const r = `acme/sugg-${++n}`
    for (let i = 0; i < 8; i++) {
      await fake.forge.createBranch(r, `f${i}`)
      fake.commit(r, `f${i}`, `src/f${i}.ts`, 'x')
      if (i < 2) fake.commit(r, `f${i}`, 'CHANGELOG.md', 'x')
      if (i === 0) fake.commit(r, `f${i}`, 'rare.md', 'x')
      const pr = await fake.forge.openPullRequest(r, { title: `p${i}`, head: `f${i}`, base: 'main' })
      fake.merge(r, pr.number)
    }
    expect(await overlap.suggestOverlapIgnore(fake.forge, r)).toEqual([{ path: 'CHANGELOG.md', percent: 25 }])
    expect(await overlap.suggestOverlapIgnore(fake.forge, `acme/sugg-empty-${n}`)).toEqual([])
  })
})

describe('stage entry honours blockedBy', () => {
  it('an approved plan entering Build with an open blocker starts no Run; it starts once the blocker closes', async () => {
    process.env.BAUHERR_PACK_DIR = new URL('./fixtures/gated-pack', import.meta.url).pathname
    const blocker = await ticket('blocker', 'review', ['docs/x.md'])
    const c = await ticket('c', 'plan', ['src/c.ts'], { blockedBy: [blocker.id] })
    await fake.tickets(repo).addBlockedBy(String(c.n), String(blocker.n)) // expandPlan mirrors `after:` edges to the forge, which now owns the set
    await actions.approvePlan(payload, user, { ticket: c.id })
    await poll()
    expect(await reload(c.id)).toMatchObject({ stage: 'build' })
    expect(await runs(c.id, 'build')).toHaveLength(0)
    await payload.update({ collection: 'tickets', id: blocker.id, data: { state: 'closed' }, ...o })
    await poll()
    expect(await runs(c.id, 'build')).toHaveLength(1)
  })
})
