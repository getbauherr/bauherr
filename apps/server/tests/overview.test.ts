import { fileURLToPath } from 'node:url'
import { GATES } from '../src/app/(app)/lib/gates'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'
import { heartbeatAge } from '../src/app/(app)/lib/format'
import { NEEDS, needsYou, releaseWord, stageOf } from '../src/app/(app)/lib/needs-you'
import { DEFAULT } from '../src/lib/workflow'

process.env.BAUHERR_PACK_DIR = fileURLToPath(new URL('./fixtures/gated-pack', import.meta.url))

const t = (stage: string | null, labels: string[] = []) => ({ stage, labels })
const r = (stage: string, status: string) => ({ stage, status })

describe('needsYou', () => {
  it('asks for the round cap only past the cap; a review the factory could not conclude below it reads Needs you', () => {
    const rev = (reviewState: string, reviewRounds: number) => ({ ...t('review'), reviewState, reviewRounds })
    expect(needsYou(DEFAULT(), rev('needs_human', 3), r('review', 'succeeded'))).toBe('Round cap reached')
    expect(needsYou(DEFAULT(), rev('needs_human', 2), r('review', 'succeeded'))).toBe('Needs you')
    expect(needsYou(DEFAULT(), rev('needs_human', 0), r('review', 'succeeded'))).toBe('Needs you')
    expect(needsYou(DEFAULT(), rev('waiting_checks', 3), r('review', 'succeeded'))).toBeNull()
  })

  it('asks for plan approval once a plan Run succeeded and no approval label exists', () => {
    expect(needsYou(DEFAULT(), t('plan'), r('plan', 'succeeded'))).toBe('Approve plan')
    expect(needsYou(DEFAULT(), t('plan', ['bauherr:approved:plan']), r('plan', 'succeeded'))).toBeNull()
    expect(needsYou(DEFAULT(), t('plan'), r('plan', 'running'))).toBeNull()
    expect(needsYou(DEFAULT(), t('plan'), null)).toBeNull()
  })
  it('asks for the decisions first while critical rows are unanswered', () => {
    expect(needsYou(DEFAULT(), t('plan'), r('plan', 'succeeded'), 1)).toBe('Answer decisions')
    expect(needsYou(DEFAULT(), t('plan', ['bauherr:approved:plan']), r('plan', 'succeeded'), 1)).toBeNull()
  })
  it('treats an in-progress plan Run as Plan in progress, not needs-you', () => {
    for (const status of ['running', 'queued', 'awaiting_session']) expect(needsYou(DEFAULT(), t('plan'), r('plan', status))).toBeNull()
  })
  it('flags needs_human and failed Runs in that order; review is the factory\'s, never needs-you', () => {
    expect(needsYou(DEFAULT(), t('build'), r('build', 'needs_human'))).toBe('Run needs you')
    expect(needsYou(DEFAULT(), t('review'), r('build', 'succeeded'))).toBeNull()
    expect(needsYou(DEFAULT(), t('review'), r('build', 'needs_human'))).toBe('Run needs you')
    expect(needsYou(DEFAULT(), t('build'), { ...r('build', 'failed'), reasonKind: 'decision' })).toBe('Run failed')
  })
  it('a Build Run that needed a person asks nothing once the Ticket reached release (MR merged during Build, #693)', () => {
    expect(needsYou(DEFAULT(), t('release'), r('build', 'needs_human'))).not.toBe('Run needs you')
    expect(needsYou(DEFAULT(), t('release'), { ...r('build', 'failed'), reasonKind: 'decision' })).not.toBe('Run failed')
  })
  it('hides a failed Run until the escalation ladder ended, and a stuck needs_human Run always', () => {
    expect(needsYou(DEFAULT(), t('build'), r('build', 'failed'))).toBeNull()
    expect(needsYou(DEFAULT(), t('build'), { ...r('build', 'failed'), reasonKind: 'stuck' })).toBeNull()
    expect(needsYou(DEFAULT(), t('build'), { ...r('build', 'needs_human'), reasonKind: 'stuck' })).toBeNull()
    expect(needsYou(DEFAULT(), t('build'), { ...r('build', 'needs_human'), reasonKind: 'access' })).toBe('Run needs you')
  })
  it('asks to accept on staging once the deploy is observed, and flags a timeout', () => {
    const rel = (releaseState: string | null, labels: string[] = []) => ({ stage: 'release', labels, releaseState })
    expect(needsYou(DEFAULT(), rel('on_staging'), r('build', 'succeeded'))).toBe('Accept on staging')
    expect(needsYou(DEFAULT(), rel('timed_out'), r('build', 'succeeded'))).toBe('Staging not confirmed')
    expect(needsYou(DEFAULT(), rel('waiting'), r('build', 'succeeded'))).toBeNull()
    expect(needsYou(DEFAULT(), rel('on_staging', ['bauherr:approved:staging']), r('build', 'succeeded'))).toBeNull()
  })
  it('asks to approve production after staging acceptance and flags a failed deploy', () => {
    const rel = (productionState: string, labels: string[] = ['bauherr:approved:staging']) => ({ stage: 'release', labels, productionState })
    const run = r('build', 'succeeded')
    expect(needsYou(DEFAULT(), rel('awaiting_approval'), run)).toBe('Approve production')
    expect(needsYou(DEFAULT(), rel('deploying'), run)).toBeNull()
    expect(needsYou(DEFAULT(), rel('failed', ['bauherr:approved:staging', 'bauherr:approved:production']), run)).toBe('Production deploy failed')
    expect(needsYou(DEFAULT(), rel('timed_out'), run)).toBe('Production deploy failed')
    expect(needsYou(DEFAULT(), rel('deployed'), run)).toBeNull()
  })
  it('gives every needs-you value a Gate with an action', () => {
    for (const need of NEEDS) expect(GATES[need], need).toMatchObject({ kind: expect.stringMatching(/^(plan|questions|release|production|production-checks|release-failed|review-cap|rerun|back-to-build|cancelled|expedite|decision)$/), title: expect.any(String) })
  })
  it('gives every needs-you value a sentence and a verb for the action bar', () => {
    const ctx = { stage: 'build', missing: ['D2'], open: 1 }
    for (const need of NEEDS) {
      expect(GATES[need].sentence(ctx), need).toMatch(/\S/)
      expect(GATES[need].verb(ctx), need).toMatch(/\S/)
    }
    expect(GATES['Run failed'].verb(ctx)).toBe('Re-run build')
    expect(GATES['Answer decisions'].sentence(ctx)).toContain('D2')
  })
  it('words the production states', () => {
    expect(releaseWord(DEFAULT(), { stage: 'release', productionState: 'awaiting_approval', labels: ['bauherr:approved:staging'] })).toBe('awaiting production approval')
    expect(releaseWord(DEFAULT(), { stage: 'release', productionState: 'deploying' })).toBe('deploying')
    expect(releaseWord(DEFAULT(), { stage: 'done', state: 'closed', productionState: 'deployed' })).toBe('deployed')
  })
  it('words the release stage', () => {
    expect(releaseWord(DEFAULT(), { stage: 'release', releaseState: null })).toBe('waiting')
    expect(releaseWord(DEFAULT(), { stage: 'release', releaseState: 'on_staging' })).toBe('on staging')
    expect(releaseWord(DEFAULT(), { stage: 'release', releaseState: 'timed_out' })).toBe('timed out')
    expect(releaseWord(DEFAULT(), { stage: 'done', state: 'closed', labels: ['bauherr:approved:staging'] })).toBe('accepted')
    expect(releaseWord(DEFAULT(), { stage: 'done', state: 'closed' })).toBeNull()
    expect(releaseWord(DEFAULT(), { stage: 'build' })).toBeNull()
  })
  it('is quiet for healthy tickets and tickets without a stage', () => {
    expect(needsYou(DEFAULT(), t('build'), r('build', 'running'))).toBeNull()
    expect(needsYou(DEFAULT(), t(null), null)).toBeNull()
  })
})

describe('heartbeatAge', () => {
  const now = Date.parse('2026-01-01T00:10:00Z')
  it('formats seconds, minutes, hours and flags >5 min as stale', () => {
    expect(heartbeatAge('2026-01-01T00:09:20Z', now)).toEqual({ text: '40s ago', stale: false })
    expect(heartbeatAge('2026-01-01T00:05:00Z', now)).toEqual({ text: '5m ago', stale: false })
    expect(heartbeatAge('2026-01-01T00:04:00Z', now)).toEqual({ text: '6m ago', stale: true })
    expect(heartbeatAge('2025-12-31T21:00:00Z', now)).toEqual({ text: '3h ago', stale: true })
  })
})

describe('parent stage', () => {
  it('is a Board stage that needs nothing from the Bauherr', () => {
    expect(stageOf(DEFAULT(), { stage: 'parent' })).toBe('parent')
    expect(stageOf(DEFAULT(), { stage: 'parent', state: 'closed' })).toBe('done')
    expect(needsYou(DEFAULT(), t('parent', ['bauherr:approved:plan']), null)).toBeNull()
  })
})


describe('epic rows', () => {
  const o = { overrideAccess: true } as const
  const repo = 'acme/web'
  let payload: Payload
  let fake: FakeBackend
  let testDb: TestDb
  let ws: number
  let product: number
  beforeAll(async () => {
    testDb = await createTestDb('overview_epics')
    process.env.DATABASE_URL = testDb.url
    process.env.PAYLOAD_SECRET ??= 'test-secret'
    process.env.ENCRYPTION_KEY ??= 'test-key'
    process.env.BAUHERR_E2E_FAKE_FORGE = '1'
    delete process.env.GATEWAY_ADMIN_URL
    const { getPayload } = await import('payload')
    payload = await getPayload({ config: (await import('../src/payload.config')).default })
    fake = (await import('../src/lib/fake-forge')).fakeForge()
    ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
    product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
    const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
    await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
  })
  afterAll(async () => {
    await payload?.destroy()
    await testDb?.drop(payload)
  })
  const seed = async (title: string, data: Record<string, unknown>) => {
    const issue = await fake.tickets(repo).create({ title, labels: [] })
    return (await payload.create({ collection: 'tickets', data: { title, externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', product, workspace: ws, ...data }, ...o })) as Record<string, any>
  }

  it('one card per epic in the current slice\'s column; progress from the plan; slices marked; old parent unchanged', async () => {
    const plan = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `slice ${i + 1}`, body: 'b' }))
    const split = await seed('split epic', { stage: 'parent', epic: { branch: 'b/1-epic', slices: plan(3), current: 1, mergeFailures: 0 } })
    const first = await seed('slice 1', { stage: 'done', parent: split.id, slice: { epic: split.id, branch: 'b/1-epic', index: 0, prev: null, main: null, head: 'abc', passed: true, fixes: [] } })
    const second = await seed('slice 2', { stage: 'build', parent: split.id, slice: { epic: split.id, branch: 'b/1-epic', index: 1, prev: 'abc', main: null, head: null, passed: false, fixes: [] } })
    await payload.update({ collection: 'tickets', id: split.id, data: { epic: { branch: 'b/1-epic', slices: [{ ...plan(3)[0]!, ticket: first.id }, { ...plan(3)[1]!, ticket: second.id }, plan(3)[2]!], current: 1, mergeFailures: 0 } }, ...o })
    const reviewing = await seed('reviewing epic', { stage: 'review', epic: { branch: 'b/2-epic', slices: plan(2), current: 1, mergeFailures: 0 } })
    const old = await seed('old parent', { stage: 'parent' })
    const oldKid = await seed('old kid', { stage: 'build', parent: old.id })

    const { loadOverviewRows } = await import('../src/app/(app)/lib/overview')
    const { tickets, epics } = await loadOverviewRows(ws, false)
    const row = (id: number) => tickets.find((t) => t.id === id)!
    expect(row(split.id)).toMatchObject({ stage: 'parent', epic: { total: 3, passed: 1 }, slicing: { index: 2, total: 3, stage: 'build' }, children: { total: 3, done: 1 }, slice: null })
    expect(row(second.id).slice).toEqual({ index: 2, total: 3 })
    expect(row(first.id).slice).toEqual({ index: 1, total: 3 })
    expect(row(reviewing.id)).toMatchObject({ stage: 'review', epic: { total: 2, passed: 0 }, slicing: null })
    expect(row(old.id)).toMatchObject({ epic: null, slicing: null, children: { total: 1, done: 0 } })
    expect(row(oldKid.id).slice).toBeNull()
    expect(epics.find((e) => e.id === split.id)).toMatchObject({ current: 1, slices: [{ passed: true, child: { id: first.id } }, { passed: false, child: { id: second.id } }, { passed: false, child: null }] })
    expect(epics.find((e) => e.id === old.id)!.slices).toBeUndefined()
  })
})
