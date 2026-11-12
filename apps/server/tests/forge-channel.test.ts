import { fileURLToPath } from 'node:url'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

vi.mock('next/headers', () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }))

let payload: Payload
let fake: FakeBackend
let ws: number
let productA: number
let productB: number
let admin: Record<string, any>
let actions: typeof import('../src/lib/actions')
let channel: typeof import('../src/lib/forge-channel')
let plan: typeof import('../src/app/(app)/lib/plan')
let labels: typeof import('../src/lib/gate-labels')
const o = { overrideAccess: true } as const
const REPOS = { a: 'acme/web', b: 'acme/api' }
const PLAN_LABEL = 'bauherr:approved:plan'
const STAGING = 'bauherr:approved:staging'
let testDb: TestDb

const usePack = (name: 'gated-pack' | 'owner-pack') => {
  process.env.BAUHERR_PACK_DIR = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
}

beforeAll(async () => {
  testDb = await createTestDb('forge_channel')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  usePack('owner-pack')
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  actions = await import('../src/lib/actions')
  channel = await import('../src/lib/forge-channel')
  plan = await import('../src/app/(app)/lib/plan')
  labels = await import('../src/lib/gate-labels')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  const product = (name: string, slug: string, extra = {}) => payload.create({ collection: 'products', data: { name, slug, workspace: ws, ...extra } as never, ...o }).then((p) => p.id as number)
  productA = await product('web', 'web', { productOwnerTestsStaging: true })
  productB = await product('api', 'api', { productOwnerTestsStaging: true })
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo: REPOS.a, product: productA, connection, workspace: ws }, ...o })
  await payload.create({ collection: 'ticket_sources', data: { repo: REPOS.b, product: productB, connection, workspace: ws }, ...o })
  const mk = (email: string, data: Record<string, unknown>) => payload.create({ collection: 'bauherren', data: { email, password: 'pw-123456', ...data } as never, ...o })
  admin = await mk('admin@x.io', { role: 'admin', githubLogin: 'the-admin' })
  await mk('bauherr@x.io', { role: 'bauherr', githubLogin: 'The-Bauherr', tenants: [{ tenant: ws }] })
  await mk('po-a@x.io', { role: 'product-owner', githubLogin: 'the-po-a', assignments: [{ workspace: ws, scope: 'products', products: [productA] }] })
  await mk('po-b@x.io', { role: 'product-owner', githubLogin: 'the-po-b', assignments: [{ workspace: ws, scope: 'products', products: [productB] }] })
  await mk('nolink@x.io', { role: 'bauherr', tenants: [{ tenant: ws }] })
})

afterAll(async () => {
  fake.actingAs = 'factory'
  await payload?.destroy()
  await testDb?.drop(payload)
})

const product = (p: 'a' | 'b') => (p === 'a' ? productA : productB)
const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>
const as = async <T>(login: string, fn: () => Promise<T>): Promise<T> => {
  fake.actingAs = login
  try {
    return await fn()
  } finally {
    fake.actingAs = 'factory'
  }
}
const notes = async (p: 'a' | 'b', n: string, marker: string) => (await fake.tickets(REPOS[p]).listComments(n)).filter((c) => c.body.includes(marker))

const ticketRow = async (p: 'a' | 'b', title: string, stage: 'plan' | 'release') => {
  const issue = await fake.tickets(REPOS[p]).create({ title, labels: [`bauherr:stage:${stage}`] })
  const data = stage === 'plan' ? {} : { releaseState: 'on_staging', mergeSha: `sha-${issue.number}`, releaseAt: new Date().toISOString() }
  const t = await payload.create({ collection: 'tickets', data: { title, externalId: `${p}${issue.number}`, number: issue.number, url: issue.url, state: 'open', stage, labels: [`bauherr:stage:${stage}`], product: product(p), workspace: ws, ...data } as never, ...o })
  return { id: t.id as number, n: String(issue.number) }
}

/** The label set by `login` on the forge, then checked the way the poller does. */
const labelled = async (p: 'a' | 'b', stage: 'plan' | 'release', label: string, login: string, title = `${login} sets ${label}`) => {
  const t = await ticketRow(p, title, stage)
  const ts = fake.tickets(REPOS[p])
  await as(login, () => ts.addLabels(t.n, [label]))
  const check = async () => labels.verifyGateLabels(payload, await reload(t.id), (await ts.get(t.n)).labels.concat(label), ts, labels.GATE_LABELS.filter((g) => g.label === label))
  return { ...t, check, rejections: () => notes(p, t.n, 'label-rejected') }
}

describe('a gate label from the forge', () => {
  it('from an author whose login nobody has linked is removed with one comment, however often it is checked', async () => {
    const l = await labelled('a', 'plan', PLAN_LABEL, 'stranger')
    expect(await l.check()).toMatchObject({ accepted: [], rejected: [PLAN_LABEL] })
    expect(await l.check()).toMatchObject({ rejected: [PLAN_LABEL] })
    const [c, ...rest] = await l.rejections()
    expect(rest).toHaveLength(0)
    expect(c!.body).toContain('whose forge login is not linked')
    expect(await payload.count({ collection: 'human_touches', where: { ticket: { equals: l.id } }, ...o })).toMatchObject({ totalDocs: 0 })
  })

  it('from a linked Bauherr or Admin counts, whatever the case of the login, and records the touch with that login', async () => {
    for (const login of ['the-admin', 'THE-BAUHERR', 'the-bauherr']) {
      const l = await labelled('a', 'plan', PLAN_LABEL, login)
      expect(await l.check(), login).toMatchObject({ accepted: [PLAN_LABEL], rejected: [] })
      expect(await l.rejections()).toHaveLength(0)
      expect(((await payload.find({ collection: 'human_touches', where: { ticket: { equals: l.id } }, ...o })).docs[0] as Record<string, any>).actor).toBe(login)
    }
  })

  it('from a linked Product owner counts on an assigned Product where the checkpoint asks the Product owner (owner-pack: the plan and staging)', async () => {
    expect(await (await labelled('a', 'plan', PLAN_LABEL, 'The-PO-A')).check()).toMatchObject({ accepted: [PLAN_LABEL] })
    expect(await (await labelled('a', 'release', STAGING, 'the-po-a')).check()).toMatchObject({ accepted: [STAGING] })
  })

  it('from the Product owner of Product A does not move Product B', async () => {
    const plan = await labelled('b', 'plan', PLAN_LABEL, 'the-po-a')
    expect(await plan.check()).toMatchObject({ accepted: [], rejected: [PLAN_LABEL] })
    expect(await plan.rejections()).toHaveLength(1)
    expect(await (await labelled('b', 'release', STAGING, 'the-po-a')).check()).toMatchObject({ accepted: [], rejected: [STAGING] })
  })

  it('from a Product owner does not count where the checkpoint asks the Bauherr (gated-pack), nor on the Expedite lane', async () => {
    usePack('gated-pack')
    try {
      expect(await (await labelled('a', 'plan', PLAN_LABEL, 'the-po-a')).check()).toMatchObject({ accepted: [], rejected: [PLAN_LABEL] })
      expect(await (await labelled('a', 'plan', PLAN_LABEL, 'the-bauherr')).check()).toMatchObject({ accepted: [PLAN_LABEL] })
    } finally {
      usePack('owner-pack')
    }
    expect(await (await labelled('a', 'plan', 'bauherr:expedite', 'the-po-a')).check()).toMatchObject({ accepted: [], rejected: ['bauherr:expedite'] })
  })
})

const SHEET = '## Goal\n- Ship it\n\n## Steps\n1. Do it\n\n## Decisions\n- **D1** Pricing? Alternatives: free. Default: paid. critical: true. for: bauherr.\n- **D2** Wording? Alternatives: formal. Default: friendly. critical: true.'
const planTicket = async (p: 'a' | 'b', title: string) => {
  const t = await ticketRow(p, title, 'plan')
  await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'plan', status: 'succeeded', mode: 'autonomous', workspace: ws }, ...o })
  await actions.submitPlan(payload, admin, { ticket: t.id, markdown: SHEET })
  const ts = fake.tickets(REPOS[p])
  const read = async (notify = false) => channel.decisionComments(payload, await reload(t.id), ts, { notify })
  const open = async (notify = false) => plan.openCritical(await read(notify)).map((d) => d.id)
  const post = (login: string, body: string) => as(login, () => ts.comment(t.n, `${plan.DECISIONS_MARKER}\n${body}`))
  return { ...t, ts, read, open, post, ignored: () => notes(p, t.n, 'answers-ignored') }
}

describe('an answers comment from the forge (owner-pack: the sheet asks the Product owner; D1 is for the Bauherr)', () => {
  it('from an unlinked author is ignored, with one comment saying why', async () => {
    const t = await planTicket('a', 'stranger answers')
    expect(await t.open()).toEqual(['D1', 'D2'])
    await t.post('stranger', 'D1: free\nD2: formal')
    expect(await t.open(true)).toEqual(['D1', 'D2'])
    expect(await t.open(true)).toEqual(['D1', 'D2'])
    const notices = await t.ignored()
    expect(notices).toHaveLength(1)
    expect(notices[0]!.body).toContain('@stranger is not linked')
    // a page render (no notify) writes nothing
    await t.post('another', 'D1: free')
    await t.open()
    expect(await t.ignored()).toHaveLength(1)
  })

  it('from a linked Bauherr counts, whatever the case of the login', async () => {
    const t = await planTicket('a', 'bauherr answers')
    await t.post('the-BAUHERR', 'D1: free\nD2: formal')
    expect(await t.open(true)).toEqual([])
    expect(await t.ignored()).toHaveLength(0)
  })

  it('from a linked Product owner counts only for the rows addressed to the Product owner, on an assigned Product', async () => {
    const t = await planTicket('a', 'po answers')
    await t.post('The-PO-A', 'D1: free\nD2: formal')
    expect(await t.open(true)).toEqual(['D1'])
    expect(plan.parseAnswers(plan.answersOf(await t.read())!.body)).toEqual({ D2: 'formal' })
    const [note, ...rest] = await t.ignored()
    expect(rest).toHaveLength(0)
    expect(note!.body).toContain('D1 is the Bauherr')
    // the Product owner of Product B has no say on this Ticket at all
    const b = await planTicket('a', 'other po answers')
    await b.post('the-po-b', 'D2: formal')
    expect(await b.open(true)).toEqual(['D1', 'D2'])
    expect((await b.ignored())[0]!.body).toContain('@the-po-b is not linked')
  })

  it('a row the Product owner adds counts only when it asks the Product owner', async () => {
    const t = await planTicket('a', 'po adds rows')
    await t.post('the-po-a', 'D2: formal\n\n## Decisions\n- **D8** Footer? Alternatives: none. Default: short. critical: true.\n- **D9** Budget? Alternatives: none. Default: low. critical: true. for: bauherr.')
    expect(plan.addedOf(await t.read()).map((d) => d.id)).toEqual(['D8'])
  })

  it('written by the factory (the answers of the Ticket page, chat and MCP) count, and a later stranger comment does not shadow them', async () => {
    const t = await planTicket('a', 'factory answers')
    await actions.postDecisions(payload, admin, { ticket: t.id, workspaceId: ws, answers: [{ id: 'D1', title: 'Pricing', answer: 'free' }, { id: 'D2', title: 'Wording', answer: 'formal' }] })
    const [mine] = (await t.ts.listComments(t.n)).filter((c) => c.body.startsWith(plan.DECISIONS_MARKER))
    expect(mine!.author).toBe('factory')
    expect(await t.open()).toEqual([])
    await t.post('stranger', 'D1: paid')
    await t.post('the-po-a', 'D2: formal')
    expect(plan.parseAnswers(plan.answersOf(await t.read())!.body)).toEqual({ D2: 'formal' })
    expect(await t.open()).toEqual(['D1'])
  })

  it('a counted comment of a person is not edited by the factory: the merged answers go in a newer comment', async () => {
    const t = await planTicket('a', 'merge')
    await t.post('the-bauherr', 'D1: free')
    await actions.postDecisions(payload, admin, { ticket: t.id, workspaceId: ws, answers: [{ id: 'D2', title: 'Wording', answer: 'formal' }] })
    const all = (await t.ts.listComments(t.n)).filter((c) => c.body.startsWith(plan.DECISIONS_MARKER))
    expect(all.map((c) => c.author)).toEqual(['the-bauherr', 'factory'])
    expect(all[0]!.body).toBe(`${plan.DECISIONS_MARKER}\nD1: free`)
    expect(plan.parseAnswers(all[1]!.body)).toEqual({ D1: 'free', D2: 'formal' })
    expect(await t.open()).toEqual([])
  })

  it('knows the factory by the credential: the whoami login, or a [bot] author for an App token', () => {
    expect(channel.isFactoryAuthor('Factory', 'factory')).toBe(true)
    expect(channel.isFactoryAuthor('someone', 'factory')).toBe(false)
    expect(channel.isFactoryAuthor('bauherr[bot]', null)).toBe(true)
    expect(channel.isFactoryAuthor('someone', null)).toBe(false)
  })
})

describe('the forge login on the account', () => {
  it('belongs to one account, case ignored', async () => {
    await expect(payload.create({ collection: 'bauherren', data: { email: 'dup@x.io', password: 'pw-123456', role: 'bauherr', githubLogin: 'THE-ADMIN' } as never, ...o })).rejects.toThrow()
    const free = await payload.create({ collection: 'bauherren', data: { email: 'free@x.io', password: 'pw-123456', role: 'bauherr', githubLogin: 'free-login' } as never, ...o })
    await expect(payload.update({ collection: 'bauherren', id: free.id, data: { githubLogin: 'The-Bauherr' }, ...o })).rejects.toThrow()
    await expect(payload.update({ collection: 'bauherren', id: free.id, data: { githubLogin: 'FREE-LOGIN' }, ...o })).resolves.toBeTruthy()
  })
})

describe('Settings > Health on the forge channel', () => {
  it('names the logins the retired gateOwners list left without an account, until someone links them', async () => {
    const { loadHealth } = await import('../src/app/(app)/lib/settings')
    await payload.update({ collection: 'products', id: productA, data: { unlinkedGateOwners: 'ghost,Dana' } as never, ...o })
    expect((await loadHealth(ws)).forge.unlinked).toEqual([{ product: 'web', logins: ['ghost', 'Dana'] }])
    await payload.create({ collection: 'bauherren', data: { email: 'dana@x.io', password: 'pw-123456', role: 'bauherr', githubLogin: 'dana', tenants: [{ tenant: ws }] } as never, ...o })
    expect((await loadHealth(ws)).forge.unlinked).toEqual([{ product: 'web', logins: ['ghost'] }])
  })

  it('says plainly when no Bauherr or Admin of a Workspace with a forge has a linked login', async () => {
    const { loadHealth } = await import('../src/app/(app)/lib/settings')
    expect((await loadHealth(ws)).forge.nobodyLinked).toBe(false)
    const people = (await payload.find({ collection: 'bauherren', where: { role: { in: ['admin', 'bauherr'] }, githubLogin: { exists: true } }, pagination: false, depth: 0, ...o })).docs as Record<string, any>[]
    for (const u of people) await payload.update({ collection: 'bauherren', id: u.id, data: { githubLogin: null }, ...o })
    try {
      expect((await loadHealth(ws)).forge.nobodyLinked).toBe(true)
    } finally {
      for (const u of people) await payload.update({ collection: 'bauherren', id: u.id, data: { githubLogin: u.githubLogin }, ...o })
    }
    expect((await loadHealth(ws)).forge.nobodyLinked).toBe(false)
  })
})
