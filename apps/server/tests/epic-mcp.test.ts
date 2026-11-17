import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { claimOnly } from './helpers/claim'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let fake: FakeBackend
let member: Record<string, any>
let product: number
let ws: number
let call: (user: Record<string, any>, name: string, input: unknown) => Promise<any>
let jobs: typeof import('../src/jobs')
let actions: typeof import('../src/lib/actions')
const o = { overrideAccess: true } as const
const repo = 'acme/web'
const EVIDENCE = 'Refs it\n\n## Evidence\n| Goal | verified |\n\n## Blast radius\nSafe because x. Sure: `read the code`\n'
const checked = ['correctness', 'over-engineering', 'spec-vs-plan', 'evidence'].map((area) => ({ area, note: `checked ${area}` }))

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('epic_mcp')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  jobs = await import('../src/jobs')
  actions = await import('../src/lib/actions')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  const { callTool } = await import('../src/lib/mcp-tools')
  call = (user, name, input) => callTool({ payload, user, actor: { kind: 'human' } }, name, input)
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'session' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
  member = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>
const comments = async (n: number | string) => (await fake.tickets(repo).listComments(String(n))).map((c) => c.body).join('\n')
const issue = async (title: string, stage: string) => {
  const i = await fake.tickets(repo).create({ title, labels: [`bauherr:stage:${stage}`] })
  return { number: i.number as number, url: i.url as string }
}

/** An epic parent in `stage` with `count` slice sub-tickets (slice 2 started, slice 1 passed), and the epic branch. */
const seedEpic = async (stage = 'review', count = 2) => {
  const p = await issue('epic', stage)
  const branch = `bauherr/${p.number}-epic`
  await fake.forge.createBranch(repo, branch)
  fake.commit(repo, branch, 'a.ts', 'x')
  const pr = await fake.forge.openPullRequest(repo, { title: 'epic', body: EVIDENCE, head: branch, base: 'main' })
  const parent = await payload.create({ collection: 'tickets', data: { title: 'epic', externalId: String(p.number), number: p.number, url: p.url, state: 'open', stage, product, workspace: ws }, ...o })
  const subs: Record<string, any>[] = []
  for (let i = 0; i < count; i++) {
    const s = await issue(`slice ${i + 1}`, i === count - 1 ? 'build' : 'done')
    subs.push(
      await payload.create({
        collection: 'tickets',
        data: { title: `slice ${i + 1}`, externalId: String(s.number), number: s.number, url: s.url, state: 'open', stage: i === count - 1 ? 'build' : 'done', product, workspace: ws, slice: { epic: parent.id, branch, index: i, prev: i ? `head${i - 1}` : null, main: null, head: i === count - 1 ? null : `head${i}`, passed: i < count - 1, fixes: [] } },
        ...o,
      }),
    )
  }
  const epic = { branch, slices: subs.map((s, i) => ({ title: `slice ${i + 1}`, body: '', ticket: s.id })), current: count - 1, mergeFailures: 0 }
  await payload.update({ collection: 'tickets', id: parent.id, data: { epic }, ...o })
  return { parent: await reload(parent.id as number), subs, branch, pr }
}
const claim = async (ticket: Record<string, any>, stage: string) => {
  const started = await jobs.startRunIfNeeded(payload, ticket as any, stage)
  const claimed = await claimOnly(payload, call, member, ws, started!.run.id)
  return { runId: started!.run.id as number, leaseToken: claimed.leaseToken as string, claimed }
}

it('get_ticket and claim_run give a slice its epic context, the parent its slices', async () => {
  const { parent, subs, branch } = await seedEpic()
  await actions.updateWorklog(payload, member, { ticket: parent.id, markdown: '**Decisions**\n- shared interface' })
  const slice = await call(member, 'get_ticket', { ticket: subs[1]!.id })
  expect(slice.epic).toMatchObject({ parent: { id: parent.id, number: parent.number }, branch, slice: '2/2', prev: 'head0', mergeMainFirst: true })
  expect(slice.epic.worklog).toContain('shared interface')
  const first = await call(member, 'get_ticket', { ticket: subs[0]!.id })
  expect(first.epic).toMatchObject({ slice: '1/2', prev: null, mergeMainFirst: false })
  const top = await call(member, 'get_ticket', { ticket: parent.id })
  expect(top.epic).toEqual({ branch, slices: [{ number: subs[0]!.number, title: 'slice 1', prev: null, head: 'head0', fixes: [] }, { number: subs[1]!.number, title: 'slice 2', prev: 'head0', head: null, fixes: [] }] })

  const build = await claim(subs[1]!, 'build')
  expect(build.claimed.ticket.epic).toMatchObject({ slice: '2/2', branch })
  expect(build.claimed.slices).toBeUndefined()
  const review = await claim(parent, 'review')
  expect(review.claimed.ticket.epic.slices).toHaveLength(2)
  expect(review.claimed.slices).toEqual(top.epic.slices)
})

it('tickets without epic or slice get no epic fields', async () => {
  const i = await issue('plain', 'build')
  const t = await payload.create({ collection: 'tickets', data: { title: 'plain', externalId: String(i.number), number: i.number, url: i.url, state: 'open', stage: 'build', product, workspace: ws }, ...o })
  expect(await call(member, 'get_ticket', { ticket: t.id })).not.toHaveProperty('epic', expect.anything())
  const run = await claim(t, 'build')
  expect(run.claimed.ticket).not.toHaveProperty('epic')
  expect(await actions.tagFixes(payload, t)).toEqual({ tagged: 0, untagged: 0 })
})

it('submit_review on an epic: changes needs a slice on every finding, clean needs none', async () => {
  const { parent, subs } = await seedEpic()
  const r = await claim(parent, 'review')
  const finding = { severity: 'high', class: 'security', file: 'a.ts', line: 3, msg: 'x', scenario: 'when a, then b' }
  const body = { runId: r.runId, leaseToken: r.leaseToken, verdict: 'changes', checked, markdown: 'm' }
  await expect(call(member, 'submit_review', { ...body, findings: [finding] })).rejects.toThrow('finding 0 needs slice')
  await expect(call(member, 'submit_review', { ...body, findings: [{ ...finding, slice: 9999 }] })).rejects.toThrow('finding 0 needs slice')
  await expect(call(member, 'submit_review', { ...body, findings: [{ ...finding, slice: 0 }] })).rejects.toThrow('slice must be a positive integer')
  expect((await payload.findByID({ collection: 'runs', id: r.runId, ...o })).status).toBe('running')
  await expect(call(member, 'submit_review', { ...body, findings: [{ ...finding, slice: subs[0]!.number }] })).resolves.toMatchObject({ verdict: 'changes' })
  expect((await payload.findByID({ collection: 'runs', id: r.runId, ...o })).findings).toMatchObject([{ slice: subs[0]!.number }])
})

it('finish_run on a slice links its PR as the epic PR once, never over an existing one', async () => {
  const { parent, subs, pr } = await seedEpic()
  const r = await claim(subs[1]!, 'build')
  await call(member, 'finish_run', { runId: r.runId, leaseToken: r.leaseToken, status: 'succeeded', prUrl: pr.url })
  expect((await reload(parent.id)).epic.pr).toBe(pr.url)

  const other = await seedEpic()
  await payload.update({ collection: 'tickets', id: other.parent.id, data: { epic: { ...other.parent.epic, pr: 'https://example.test/pull/1' } }, ...o })
  const r2 = await claim(other.subs[1]!, 'build')
  await call(member, 'finish_run', { runId: r2.runId, leaseToken: r2.leaseToken, status: 'succeeded', prUrl: other.pr.url })
  expect((await reload(other.parent.id)).epic.pr).toBe('https://example.test/pull/1')
})

it('tagFixes: a trailer lands on the owning slice, an untagged fix under Open on the parent; reruns add nothing', async () => {
  const { parent, subs } = await seedEpic('build')
  const reviewRun = await jobs.startRunIfNeeded(payload, parent as any, 'review')
  await payload.update({ collection: 'runs', id: reviewRun!.run.id, data: { status: 'succeeded', verdict: 'changes', reviewedSha: 'reviewed0' }, ...o })
  fake.setCommits(repo, [
    { sha: 'fix2222222', message: `Fix the thing\n\nBauherr-Slice: #${subs[0]!.number}` },
    { sha: 'fix1111111', message: 'Fix without trailer' },
    { sha: 'fix3333333', message: 'Fix elsewhere\n\nBauherr-Slice: #99999' },
  ])
  expect(await actions.tagFixes(payload, parent as any, 'head9')).toEqual({ tagged: 1, untagged: 2 })
  const sub = await reload(subs[0]!.id)
  expect(sub.slice.fixes).toEqual([{ sha: 'fix2222222', finding: 'Fix the thing' }])
  const events = (await payload.find({ collection: 'ticket_events', where: { and: [{ ticket: { equals: sub.id } }, { cause: { equals: 'epic:fix' } }] }, ...o })).docs
  expect(events).toMatchObject([{ stage: 'done', note: 'fix2222 Fix the thing' }])
  expect(await comments(subs[0]!.number)).toContain('Epic fix fix2222: Fix the thing')
  const open = await comments(parent.number)
  expect(open).toContain('fix1111 Fix without trailer')
  expect(open).toContain('fix3333 Fix elsewhere')

  expect(await actions.tagFixes(payload, parent as any, 'head9')).toEqual({ tagged: 0, untagged: 2 })
  expect((await reload(subs[0]!.id)).slice.fixes).toHaveLength(1)
  expect((await comments(parent.number)).match(/fix1111/g)).toHaveLength(1)
})
