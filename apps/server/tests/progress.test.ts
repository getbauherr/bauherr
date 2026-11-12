import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { lintTemplate, packTemplate, parseSections, TEMPLATE_NAMES } from '../src/lib/templates'
import { compile, DEFAULT, parseFactory, type Workflow } from '../src/lib/workflow'
import { createTestDb, type TestDb } from './helpers/test-db'

// adapters.ts reads this when it loads, so it is set before the first import of progress.ts
process.env.BAUHERR_E2E_FAKE_FORGE = '1'
const pack = (name: string): Workflow => compile(parseFactory(readFileSync(fileURLToPath(new URL(`./fixtures/${name}/factory.yaml`, import.meta.url)), 'utf8')))
const tpl = packTemplate('progress')
const run = (stage: string, status = 'running', kind?: string) => ({ stage, kind, status, mode: 'autonomous', createdAt: '2026-01-01T00:00:00Z' })

describe('progressOf: one plain state per key, by stage kind', () => {
  let progressOf: typeof import('../src/lib/progress').progressOf
  beforeAll(async () => {
    progressOf = (await import('../src/lib/progress')).progressOf
  })
  const wf = () => DEFAULT()
  const of = (t: Record<string, unknown>, facts: Partial<Parameters<typeof progressOf>[2]> = {}, w = wf(), tp = tpl) => progressOf(w, { state: 'open', labels: [], ...t }, { run: null, needsYou: null, ...facts }, tp)

  it('received, question, planning, approval, building, reviewing', () => {
    expect(of({ stage: 'triage' })).toMatchObject({ key: 'received', headline: 'Received. The factory is reading it.', step: 0 })
    expect(of({ stage: 'triage' }, { needsYou: 'Answer questions', link: '/tickets/1' })).toMatchObject({ key: 'question', headline: 'Questions for you.', link: '/tickets/1', step: 0 })
    expect(of({ stage: 'plan' }, { needsYou: 'Answer decisions' }).key).toBe('question')
    expect(of({ stage: 'plan' }, { run: run('plan') })).toMatchObject({ key: 'planning', headline: 'Being planned.', step: 1 })
    expect(of({ stage: 'plan' }, { needsYou: 'Approve plan' })).toMatchObject({ key: 'approval', headline: 'The plan is waiting for approval.' })
    expect(of({ stage: 'build' }, { run: run('build') })).toMatchObject({ key: 'building', headline: 'Being built.', step: 2 })
    expect(of({ stage: 'review' }, { run: run('review') })).toMatchObject({ key: 'reviewing', headline: 'Being reviewed.', step: 3 })
  })

  it('staging names the link and how to accept; waiting is one plain line per cause', () => {
    const staging = of({ stage: 'release', releaseState: 'on_staging' }, { needsYou: 'Accept on staging', stagingUrl: 'https://staging.example', link: '/tickets/1' })
    expect(staging).toMatchObject({ key: 'staging', headline: 'Ready to try on staging.', detail: 'Try it here: https://staging.example', step: 4 })
    expect(staging.next).toContain('the Bauherr')
    expect(of({ stage: 'release', releaseState: 'on_staging' }, { needsYou: 'Accept on staging' }).detail).toBeUndefined()
    expect(of({ stage: 'review', reviewState: 'waiting_checks' }).headline).toBe('Waiting for the automated checks to pass.')
    expect(of({ stage: 'review', reviewState: 'queued' }).headline).toBe('Waiting in the merge queue.')
    expect(of({ stage: 'release', releaseState: 'waiting' }).headline).toBe('Being deployed to staging.')
    expect(of({ stage: 'release', productionState: 'deploying', labels: ['bauherr:approved:staging'] }).headline).toBe('Being released to production.')
    expect(of({ stage: 'release', productionState: 'awaiting_approval', labels: ['bauherr:approved:staging'] }, { needsYou: 'Approve production' }).headline).toBe('Accepted. Waiting for approval to go live.')
  })

  it('released carries the release note line, closed without a change does not claim one, stuck says why', () => {
    expect(of({ stage: 'done', state: 'closed', mergeSha: 'abc', stagingTldr: { whatYouGet: '- Download invoices as CSV\n\n**Progress**\n- x', found: '' } })).toMatchObject({ key: 'released', headline: 'Released.', detail: 'Download invoices as CSV', step: 5 })
    expect(of({ stage: 'done', state: 'closed' })).toMatchObject({ key: 'closed', headline: 'Closed without a change.', step: null })
    expect(of({ stage: 'review', liveness: { cause: 'checks-red', need: null, at: 'x' } })).toMatchObject({ key: 'stuck', headline: 'Stuck: the automated checks fail.', detail: 'A maintainer has been asked to look at it.' })
    expect(of({ stage: 'build' }, { needsYou: 'Run failed' }).headline).toBe('Stuck: the automated work on it failed.')
    expect(of({ stage: 'build' }, { run: run('build', 'failed') }).key).toBe('stuck')
  })

  it('split and blocked', () => {
    expect(of({ stage: 'parent' }, { children: { total: 3, done: 1 } })).toMatchObject({ key: 'split', headline: 'Split into smaller requests.', detail: 'into 3 sub-tickets (1 done)' })
    expect(of({ stage: 'plan' }, { blockedBy: [{ number: 12 }] })).toMatchObject({ key: 'blocked', headline: 'Waiting for #12 to finish first.' })
  })

  it('a custom agent and a custom human stage use their title and keep the step of the stage before them', () => {
    const w = pack('custom-pack')
    expect(of({ stage: 'security' }, { run: run('security') }, w)).toMatchObject({ key: 'agent', headline: 'Security review in progress.', step: 2 })
    expect(of({ stage: 'signoff' }, { needsYou: 'Decision needed' }, w)).toMatchObject({ key: 'human', headline: 'Waiting for a decision: Architecture sign-off.', step: 2 })
  })

  it('renamed stages never leak: the text follows the kind', () => {
    const w = pack('renamed-pack')
    const states = [
      of({ stage: 'intake' }, {}, w), of({ stage: 'design' }, { run: run('design') }, w), of({ stage: 'code' }, { run: run('code') }, w), of({ stage: 'check' }, { run: run('check') }, w),
      of({ stage: 'ship', releaseState: 'on_staging' }, { needsYou: 'Accept on staging', stagingUrl: 'https://staging.example' }, w), of({ stage: 'shipped', state: 'closed', mergeSha: 'x' }, {}, w), of({ stage: 'epic' }, { children: { total: 2, done: 0 } }, w),
    ]
    expect(states.map((s) => s.key)).toEqual(['received', 'planning', 'building', 'reviewing', 'staging', 'released', 'split'])
    expect(JSON.stringify(states)).not.toMatch(/\b(intake|design|code|check|ship|shipped|epic)\b/i)
  })

  it('the Workspace template changes the text, and a line with an empty placeholder drops out', () => {
    const custom = { ...tpl, parsed: parseSections('## Being built {#building}\nWe are on it.\nNext: sit back.\nTry {{staging_url}}\n') }
    expect(of({ stage: 'build' }, { run: run('build') }, wf(), custom)).toMatchObject({ headline: 'We are on it.', next: 'sit back.' })
    expect(of({ stage: 'build' }, { run: run('build') }, wf(), custom).detail).toBeUndefined()
  })

  it('the pack template passes its own lint, names every key, and rejects an unknown placeholder', () => {
    expect(TEMPLATE_NAMES).toContain('progress')
    expect(lintTemplate('progress', tpl.body).filter((f) => f.level === 'error')).toEqual([])
    expect(lintTemplate('progress', `${tpl.body}\n{{nope}}`).map((f) => f.message).join('|')).toContain('{{nope}}')
    expect(lintTemplate('progress', '## Received {#received}\nx').map((f) => f.message).join('|')).toContain('{#question}')
  })
})

let payload: Payload
let fake: FakeBackend
let testDb: TestDb
let ws: number
let product: number
let calls: Record<string, number>
const o = { overrideAccess: true } as const
const repo = 'acme/web'
const MARK = '<!-- bauherr:progress -->'

const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>
/** A forge issue (authored by `author`) with its Ticket row. */
const ticket = async (data: Record<string, unknown> = {}, author = 'requester') => {
  const issue = await fake.tickets(repo).create({ title: 'Export totals', author })
  return Number((await payload.create({ collection: 'tickets', data: { title: 'Export totals', externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', labels: [], stage: 'build', product, workspace: ws, ...data }, ...o } as never)).id)
}
const comments = async (id: number) => fake.tickets(repo).listComments(String((await reload(id)).number))
const notices = async (id: number) => (await comments(id)).filter((c) => c.body.includes('bauherr:progress-notice'))

describe('syncProgress', () => {
  let sync: (ids: number[]) => Promise<number>
  beforeAll(async () => {
    testDb = await createTestDb('progress')
    process.env.DATABASE_URL = testDb.url
    process.env.PAYLOAD_SECRET ??= 'test-secret'
    process.env.ENCRYPTION_KEY ??= 'test-key'
    delete process.env.GATEWAY_ADMIN_URL
    const { getPayload } = await import('payload')
    payload = await getPayload({ config: (await import('../src/payload.config')).default })
    const { loadWorkflows } = await import('../src/lib/factory')
    await loadWorkflows(payload)
    fake = (await import('../src/lib/fake-forge')).fakeForge()
    ws = Number((await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id)
    product = Number((await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws, stagingUrl: 'https://staging.example' }, ...o })).id)
    await payload.create({ collection: 'bauherren', data: { email: 'a@x.io', password: 'pw-123456', role: 'admin', githubLogin: 'owner' }, ...o })
    const connection = Number((await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id)
    await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
    const { syncProgress } = await import('../src/lib/progress')
    sync = (ids) => syncProgress(payload, ids)
    const ts = fake.tickets(repo)
    calls = {}
    for (const m of ['get', 'comment', 'updateComment', 'listComments', 'whoami'] as const) {
      const methods = ts as unknown as Record<string, (...a: unknown[]) => unknown>
      const orig = methods[m]!.bind(ts)
      vi.spyOn(methods, m).mockImplementation((...a: unknown[]) => ((calls[m] = (calls[m] ?? 0) + 1), orig(...a)))
    }
  }, 120_000)
  afterAll(async () => {
    vi.restoreAllMocks()
    await payload?.destroy()
    await testDb?.drop(payload)
  })

  it('creates one marked Comment, then edits that same Comment; unchanged state is no forge call', async () => {
    const id = await ticket({ stage: 'plan', needsYou: 'Approve plan' })
    expect(await sync([id])).toBe(1)
    let list = await comments(id)
    expect(list).toHaveLength(1)
    expect(list[0]!.body).toContain(MARK)
    expect(list[0]!.body).toContain('**The plan is waiting for approval.**')
    expect(list[0]!.body).toContain('Received ✓ → **Planned (now)** → Built → Reviewed → On staging → Released')
    const [commentId, before] = [list[0]!.id, { ...calls }]
    expect(await sync([id])).toBe(0)
    expect(calls).toEqual(before)
    await payload.update({ collection: 'tickets', id, data: { stage: 'build', needsYou: null }, ...o })
    const edited = { ...calls }
    expect(await sync([id])).toBe(1)
    expect(['updateComment', 'comment', 'listComments'].map((m) => (calls[m] ?? 0) - (edited[m] ?? 0))).toEqual([1, 0, 0])
    list = await comments(id)
    expect(list).toHaveLength(1)
    expect(list[0]!.id).toBe(commentId)
    expect(list[0]!.body).toContain('**Being built.**')
  })

  it('adopts an existing marked Comment instead of posting a second one', async () => {
    const id = await ticket()
    const n = String((await reload(id)).number)
    await fake.tickets(repo).comment(n, `${MARK}\nold`)
    await sync([id])
    const list = await comments(id)
    expect(list.filter((c) => c.body.startsWith(MARK))).toHaveLength(1)
    expect(list[0]!.body).toContain('**Being built.**')
  })

  it('posts one notice per arrival at question, staging, released and stuck, mentioning only the issue author, across repeated sweeps', async () => {
    const id = await ticket({ stage: 'triage', labels: ['bauherr:needs-refinement'], needsYou: 'Answer questions' })
    const step = async (data: Record<string, unknown>) => {
      await payload.update({ collection: 'tickets', id, data, ...o })
      for (let i = 0; i < 3; i++) await sync([id])
    }
    await step({})
    expect((await notices(id)).map((c) => c.body)).toEqual(['<!-- bauherr:progress-notice:question -->\n@requester: Questions for you. Answer the questions in the comment on this issue.'])
    await step({ stage: 'plan', needsYou: null })
    await step({ stage: 'release', releaseState: 'on_staging', needsYou: 'Accept on staging' })
    await step({ stage: 'release', needsYou: null, state: 'closed', mergeSha: 'abc' })
    expect((await notices(id)).map((c) => /progress-notice:(\w+)/.exec(c.body)![1])).toEqual(['question', 'staging', 'released'])
    const stuck = await ticket({ stage: 'review', liveness: { cause: 'checks-red', need: null, at: 'x' } })
    for (let i = 0; i < 3; i++) await sync([stuck])
    expect((await notices(stuck)).map((c) => c.body)).toEqual(['<!-- bauherr:progress-notice:stuck -->\n@requester: Stuck: the automated checks fail.'])
    await payload.update({ collection: 'tickets', id: stuck, data: { liveness: null }, ...o })
    await sync([stuck])
    await payload.update({ collection: 'tickets', id: stuck, data: { liveness: { cause: 'run-failed', need: null, at: 'y' } }, ...o })
    await sync([stuck])
    expect(await notices(stuck)).toHaveLength(2)
    for (const c of [...(await notices(id)), ...(await notices(stuck))]) expect(c.body.match(/@\w+/g)).toEqual(['@requester'])
  })

  it('mentions nobody when the author is the factory account, a bot, or a gate owner the gate Comment already named', async () => {
    const own = await ticket({ stage: 'triage', needsYou: 'Answer questions' }, 'factory')
    const bot = await ticket({ stage: 'triage', needsYou: 'Answer questions' }, 'dependabot[bot]')
    const owner = await ticket({ stage: 'triage', needsYou: 'Answer questions', gateNotified: 'Answer questions' }, 'owner')
    for (const id of [own, bot, owner]) await sync([id])
    for (const id of [own, bot, owner]) expect(await notices(id)).toEqual([])
    expect((await comments(own))[0]!.body).toContain('**Questions for you.**')
  })

  it('does nothing while the Workspace switch is off', async () => {
    const off = Number((await payload.create({ collection: 'workspaces', data: { name: 'quiet', slug: 'quiet', progressComments: false }, ...o })).id)
    const quiet = Number((await payload.create({ collection: 'products', data: { name: 'quiet', slug: 'quiet', workspace: off }, ...o })).id)
    const id = await ticket({ stage: 'triage', needsYou: 'Answer questions', workspace: off, product: quiet })
    const before = { ...calls }
    expect(await sync([id])).toBe(0)
    expect(calls).toEqual(before)
    expect(await comments(id)).toEqual([])
  })

  it('a forge failure never reaches the caller and the next sweep writes it', async () => {
    const id = await ticket({ stage: 'plan' })
    await sync([id])
    await payload.update({ collection: 'tickets', id, data: { stage: 'review' }, ...o })
    const ts = fake.tickets(repo)
    const spy = vi.spyOn(ts, 'updateComment').mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }))
    await expect(sync([id])).resolves.toBe(0)
    expect((await comments(id))[0]!.body).toContain('**Being planned.**')
    await expect(sync([id])).resolves.toBe(1)
    expect((await comments(id))[0]!.body).toContain('**Being reviewed.**')
    spy.mockRestore()
  })

  it('after an upgrade the sweep posts nothing; a transition creates the Comment through the job; the sweep then heals a diverged body', async () => {
    const { syncGates } = await import('../src/lib/gates')
    const { record } = await import('../src/lib/history')
    const { syncProgressTask } = await import('../src/jobs')
    const id = await ticket({ stage: 'review' })
    const before = { ...calls }
    await syncGates(payload)
    expect(calls).toEqual(before)
    expect(await comments(id)).toEqual([])
    await payload.update({ collection: 'tickets', id, data: { stage: 'build' }, ...o })
    await record(payload, id, { cause: 'poll' })
    const jobs = await payload.find({ collection: 'payload-jobs' as never, where: { taskSlug: { equals: 'sync-progress' } }, pagination: false, ...o })
    expect(jobs.docs.some((j: Record<string, any>) => j.input?.ticketId === id)).toBe(true)
    await (syncProgressTask.handler as (a: unknown) => Promise<unknown>)({ input: { ticketId: id }, req: { payload } })
    expect((await comments(id))[0]?.body).toContain('**Being built.**')
    await payload.update({ collection: 'tickets', id, data: { stage: 'review' }, ...o })
    await syncGates(payload)
    expect((await comments(id))[0]?.body).toContain('**Being reviewed.**')
    expect(await comments(id)).toHaveLength(1)
  })

  it('the job throws when the forge refuses, so the queue retries it', async () => {
    const { syncProgressTask } = await import('../src/jobs')
    const id = await ticket({ stage: 'plan' })
    const spy = vi.spyOn(fake.tickets(repo), 'comment').mockRejectedValueOnce(new Error('boom'))
    const handler = syncProgressTask.handler as (a: unknown) => Promise<unknown>
    await expect(handler({ input: { ticketId: id }, req: { payload } })).rejects.toThrow('boom')
    await expect(handler({ input: { ticketId: id }, req: { payload } })).resolves.toBeDefined()
    expect((await comments(id))[0]?.body).toContain('**Being planned.**')
    spy.mockRestore()
  })
})
