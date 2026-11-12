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
let bauherr: Record<string, any>
let po: Record<string, any>
let poOther: Record<string, any>
let actions: typeof import('../src/lib/actions')
let tools: typeof import('../src/lib/mcp-tools')
const o = { overrideAccess: true } as const
const REPOS = { a: 'acme/web', b: 'acme/api' }
let testDb: TestDb

/** `undefined` = the real pack. */
const usePack = (name?: 'gated-pack' | 'owner-pack') => {
  if (name) process.env.BAUHERR_PACK_DIR = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
  else delete process.env.BAUHERR_PACK_DIR
}

beforeAll(async () => {
  testDb = await createTestDb('checkpoints_who')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  usePack('owner-pack')
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  actions = await import('../src/lib/actions')
  tools = await import('../src/lib/mcp-tools')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ;(fake as unknown as { opts: { users?: string[] } }).opts.users = ['the-admin', 'the-po'] // the forge knows these logins
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  const product = (name: string, slug: string) => payload.create({ collection: 'products', data: { name, slug, workspace: ws, productionChecks: 'deploy' } as never, ...o }).then((p) => p.id as number)
  productA = await product('web', 'web')
  productB = await product('api', 'api')
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo: REPOS.a, product: productA, connection, workspace: ws }, ...o })
  await payload.create({ collection: 'ticket_sources', data: { repo: REPOS.b, product: productB, connection, workspace: ws }, ...o })
  admin = await payload.create({ collection: 'bauherren', data: { email: 'admin@x.io', password: 'pw-123456', role: 'admin', githubLogin: 'the-admin' }, ...o })
  bauherr = await payload.create({ collection: 'bauherren', data: { email: 'bauherr@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
  po = await payload.create({ collection: 'bauherren', data: { email: 'po@x.io', password: 'pw-123456', role: 'product-owner', githubLogin: 'the-po', assignments: [{ workspace: ws, scope: 'products', products: [productA] }] } as never, ...o })
  poOther = await payload.create({ collection: 'bauherren', data: { email: 'po2@x.io', password: 'pw-123456', role: 'product-owner', assignments: [{ workspace: ws, scope: 'products', products: [productB] }] } as never, ...o })
  for (const u of [admin, bauherr, po, poOther]) Object.assign(u, await payload.findByID({ collection: 'bauherren', id: u.id, depth: 0, ...o }))
})

afterAll(async () => {
  usePack()
  await payload?.destroy()
  await testDb?.drop(payload)
})

const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>
const labelsOf = async (product: 'a' | 'b', n: string) => (await fake.tickets(REPOS[product]).get(n)).labels
const touchesOf = async (ticket: number) => (await payload.find({ collection: 'human_touches', where: { ticket: { equals: ticket } }, sort: 'at', pagination: false, depth: 0, ...o })).docs as Record<string, any>[]
const product = (p: 'a' | 'b') => (p === 'a' ? productA : productB)

const PLAN = '## Goal\n- Ship it\n\n## Steps\n1. Do it'
/** A plan Ticket whose plan Run succeeded and whose plan Comment is posted. */
const planTicket = async (p: 'a' | 'b', title: string, markdown = PLAN) => {
  const issue = await fake.tickets(REPOS[p]).create({ title, labels: ['bauherr:stage:plan'] })
  const t = await payload.create({ collection: 'tickets', data: { title, externalId: `${p}${issue.number}`, number: issue.number, url: issue.url, state: 'open', stage: 'plan', labels: ['bauherr:stage:plan'], product: product(p), workspace: ws }, ...o })
  await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'plan', status: 'succeeded', mode: 'autonomous', workspace: ws }, ...o })
  await actions.submitPlan(payload, admin, { ticket: t.id as number, markdown })
  return { id: t.id as number, n: String(issue.number) }
}
/** A Ticket on staging (`on_staging`), or waiting for the production approval. */
const releaseTicket = async (p: 'a' | 'b', title: string, data: Record<string, unknown> = { releaseState: 'on_staging' }) => {
  const issue = await fake.tickets(REPOS[p]).create({ title, labels: ['bauherr:stage:release'] })
  const t = await payload.create({ collection: 'tickets', data: { title, externalId: `${p}${issue.number}`, number: issue.number, url: issue.url, state: 'open', stage: 'release', product: product(p), workspace: ws, mergeSha: `sha-${issue.number}`, releaseAt: new Date().toISOString(), ...data } as never, ...o })
  return { id: t.id as number, n: String(issue.number) }
}
const signoffTicket = async (p: 'a' | 'b', title: string) => {
  const issue = await fake.tickets(REPOS[p]).create({ title, labels: ['bauherr:stage:signoff'] })
  const t = await payload.create({ collection: 'tickets', data: { title, externalId: `${p}${issue.number}`, number: issue.number, url: issue.url, state: 'open', stage: 'signoff', labels: ['bauherr:stage:signoff'], product: product(p), workspace: ws }, ...o })
  return { id: t.id as number, n: String(issue.number) }
}
const refused = async (run: Promise<unknown>) => run.then(() => 'passed', (e: Error) => e.constructor.name)

describe('a gate addressed to the Product owner (owner-pack: plan, staging and the sign-off step)', () => {
  it('an assigned Product owner approves the plan; the touch records who, as whom and for whom', async () => {
    const { id, n } = await planTicket('a', 'po plan')
    await actions.approvePlan(payload, po, { ticket: id, workspaceId: ws })
    expect(await labelsOf('a', n)).toContain('bauherr:approved:plan')
    expect(await touchesOf(id)).toMatchObject([{ kind: 'approve:plan', actor: 'po@x.io', as: 'product-owner', addressee: 'product-owner' }])
  })

  it('a Bauherr and an Admin pass too, and the touch records them as bauherr', async () => {
    for (const [who, email] of [[bauherr, 'bauherr@x.io'], [admin, 'admin@x.io']] as const) {
      const { id, n } = await planTicket('a', `stepped in by ${email}`)
      await actions.approvePlan(payload, who, { ticket: id, workspaceId: ws })
      expect(await labelsOf('a', n)).toContain('bauherr:approved:plan')
      expect(await touchesOf(id)).toMatchObject([{ kind: 'approve:plan', actor: email, as: 'bauherr', addressee: 'product-owner' }])
    }
  })

  it('a Product owner accepts on staging and decides a human step; request changes is theirs too', async () => {
    const rel = await releaseTicket('a', 'staging')
    await actions.acceptStaging(payload, po, { ticket: rel.id, workspaceId: ws })
    expect(await labelsOf('a', rel.n)).toContain('bauherr:approved:staging')
    expect(await touchesOf(rel.id)).toMatchObject([{ kind: 'accept:staging', actor: 'po@x.io', as: 'product-owner', addressee: 'product-owner' }])

    const sign = await signoffTicket('a', 'sign-off')
    await actions.decide(payload, po, { ticket: sign.id, outcome: 'approve', workspaceId: ws })
    expect(await reload(sign.id)).toMatchObject({ stage: 'review' })
    expect(await touchesOf(sign.id)).toMatchObject([{ kind: 'decide:signoff:approve', as: 'product-owner', addressee: 'product-owner' }])

    const back = await releaseTicket('a', 'changes')
    await actions.requestChanges(payload, po, { ticket: back.id, note: 'the label is wrong', workspaceId: ws })
    expect(await reload(back.id)).toMatchObject({ stage: 'build' })
    expect(await touchesOf(back.id)).toMatchObject([{ kind: 'request-changes:staging', as: 'product-owner' }])
  })

  it('a Product owner never passes a gate addressed to the Bauherr: production here, the plan under the default file `gate: human`', async () => {
    const prod = await releaseTicket('a', 'production', { releaseState: 'on_staging', productionState: 'awaiting_approval' })
    expect(await refused(actions.approveProduction(payload, po, { ticket: prod.id, workspaceId: ws }))).toBe('NotAddressed')
    expect(await reload(prod.id)).toMatchObject({ productionState: 'awaiting_approval' })
    expect(await touchesOf(prod.id)).toEqual([])
    await actions.approveProduction(payload, bauherr, { ticket: prod.id, workspaceId: ws })
    expect(await reload(prod.id)).toMatchObject({ productionState: 'deploying' })
    expect(await touchesOf(prod.id)).toMatchObject([{ kind: 'approve:production', actor: 'bauherr@x.io', as: 'bauherr', addressee: 'bauherr' }])

    usePack('gated-pack')
    try {
      const { id, n } = await planTicket('a', 'bauherr plan')
      expect(await refused(actions.approvePlan(payload, po, { ticket: id, workspaceId: ws }))).toBe('NotAddressed')
      expect(await labelsOf('a', n)).not.toContain('bauherr:approved:plan')
      expect(await touchesOf(id)).toEqual([])
      await actions.approvePlan(payload, bauherr, { ticket: id, workspaceId: ws })
      expect(await touchesOf(id)).toMatchObject([{ as: 'bauherr', addressee: 'bauherr' }])
    } finally {
      usePack('owner-pack')
    }
  })

  it('a Product owner of Product A gets a 404 on Product B and cannot decide it, however it is addressed', async () => {
    const plan = await planTicket('b', 'B plan')
    const rel = await releaseTicket('b', 'B staging')
    const sign = await signoffTicket('b', 'B sign-off')
    const prod = await releaseTicket('b', 'B production', { releaseState: 'on_staging', productionState: 'awaiting_approval' })
    const w = { workspaceId: ws }
    expect(
      await Promise.all([
        refused(actions.approvePlan(payload, po, { ticket: plan.id, ...w })),
        refused(actions.acceptStaging(payload, po, { ticket: rel.id, ...w })),
        refused(actions.requestChanges(payload, po, { ticket: rel.id, note: 'x', ...w })),
        refused(actions.decide(payload, po, { ticket: sign.id, outcome: 'approve', ...w })),
        refused(actions.approveProduction(payload, po, { ticket: prod.id, ...w })),
        refused(actions.postDecisions(payload, po, { ticket: plan.id, answers: [{ id: 'D1', title: 't', answer: 'a' }], ...w })),
        refused(actions.finishRefinement(payload, po, { ticket: plan.id, ...w })),
        refused(actions.approvePlan(payload, po, { ticket: 999_999, ...w })),
      ]),
    ).toEqual(Array(8).fill('NotInWorkspace'))
    // the other Product owner is the one who may
    await actions.approvePlan(payload, poOther, { ticket: plan.id, workspaceId: ws })
    expect(await labelsOf('b', plan.n)).toContain('bauherr:approved:plan')
    expect(await touchesOf(rel.id)).toEqual([])
  })

  it('an agent key is refused on a gate addressed to a person, a Bauherr on a personal key passes through the same function', async () => {
    const { id, n } = await planTicket('a', 'agent plan')
    const { mintAgentKey, resolveAgentKey } = await import('../src/lib/api-key')
    const agent = { payload, user: bauherr, actor: { kind: 'agent' as const, keyId: (await resolveAgentKey(payload, await mintAgentKey(payload, bauherr as never, 'checkpoints')))!.keyId } }
    await expect(tools.callTool(agent, 'approve', { ticket: id, gate: 'plan' })).rejects.toThrow(/forbidden: approve needs a human/)
    const sign = await signoffTicket('a', 'agent sign-off')
    await expect(tools.callTool(agent, 'decide', { ticket: sign.id, outcome: 'approve' })).rejects.toThrow(/forbidden: decide needs a human/)
    expect(await labelsOf('a', n)).not.toContain('bauherr:approved:plan')
    await tools.callTool({ payload, user: bauherr, actor: { kind: 'human' } }, 'approve', { ticket: id, gate: 'plan' })
    expect(await touchesOf(id)).toMatchObject([{ as: 'bauherr', addressee: 'product-owner' }])
  })
})

describe('a decision sheet with rows for different people (default: the checkpoint asks the Product owner)', () => {
  const SHEET = `${PLAN}\n\n## Decisions\n- **D1** Pricing? Alternatives: free. Default: paid. critical: true. for: bauherr.\n- **D2** Wording? Alternatives: formal. Default: friendly. critical: true.\n- **D3** Icon? Alternatives: plain. Default: round. critical: false. for: product-owner.`

  it('each person sees and answers their rows, a Bauherr all of them', async () => {
    const { id } = await planTicket('a', 'mixed sheet', SHEET)
    const refine = await import('../src/lib/refine/engine')
    const w = { ticket: id, workspaceId: ws }
    const mine = (await refine.loadRefine(payload, po, w))!
    expect(mine.viewer).toBe('product-owner')
    expect(mine.points.map((p) => [p.id, p.for])).toEqual([['D2', 'product-owner'], ['D3', 'product-owner']])
    expect([mine.models, mine.cost]).toEqual([[], { turns: [], tokens: 0, usd: null }])
    const all = (await refine.loadRefine(payload, bauherr, w))!
    expect(all.viewer).toBe('bauherr')
    expect(all.points.map((p) => [p.id, p.for])).toEqual([['D1', 'bauherr'], ['D2', 'product-owner'], ['D3', 'product-owner']])
    expect(all.models).toHaveLength(3)

    // the Product owner answers theirs through the conversation, and cannot touch the Bauherr's row
    expect((await refine.refineOption(payload, po, { ...w, point: 'D2', option: 0 })).points.map((p) => [p.id, p.status])).toEqual([['D2', 'answered'], ['D3', 'open']])
    await expect(refine.refineOption(payload, po, { ...w, point: 'D1', option: 0 })).rejects.toThrow('unknown point')
    await expect(refine.refineModel(payload, po, { ...w, tier: 'strong' })).rejects.toThrow()
    expect(await refused(actions.postDecisions(payload, po, { ...w, answers: [{ id: 'D1', title: 'Pricing', answer: 'free' }] }))).toBe('NotAddressed')
    expect(await refused(actions.postDecisions(payload, po, { ...w, answers: [], reopen: ['D1'] }))).toBe('NotAddressed')
    expect(await refused(actions.postDecisions(payload, po, { ...w, answers: [], added: [{ id: 'D9', title: 'Budget?', critical: true, default: 'x', options: ['x'], for: 'bauherr' }] }))).toBe('NotAddressed')
    // the row the Bauherr has not answered holds sending: critical points stay open for everyone
    await expect(actions.finishRefinement(payload, po, w)).rejects.toThrow('Answer the critical points first: D1')
    await actions.postDecisions(payload, bauherr, { ...w, answers: [{ id: 'D1', title: 'Pricing', answer: 'free' }] })
    expect((await refine.loadRefine(payload, bauherr, w))!.points.map((p) => p.status)).toEqual(['answered', 'answered', 'open'])
    expect((await refine.loadRefine(payload, po, w))!.points.map((p) => [p.id, p.status])).toEqual([['D2', 'answered'], ['D3', 'open']])
  })

  it('a Product owner has no conversation on a Ticket of Product B, and none where every row is the Bauherr', async () => {
    const refine = await import('../src/lib/refine/engine')
    const b = await planTicket('b', 'B sheet', SHEET)
    await expect(refine.loadRefine(payload, po, { ticket: b.id, workspaceId: ws })).rejects.toThrow('not found in this Workspace')
    const onlyBauherr = await planTicket('a', 'bauherr rows', `${PLAN}\n\n## Decisions\n- **D1** Pricing? Alternatives: free. Default: paid. critical: true. for: bauherr.`)
    expect(await refine.loadRefine(payload, po, { ticket: onlyBauherr.id, workspaceId: ws })).toBeNull()
    expect((await refine.loadRefine(payload, bauherr, { ticket: onlyBauherr.id, workspaceId: ws }))!.points).toHaveLength(1)
  })
})

describe('the gate sweep says who is asked, and the Inbox follows', () => {
  it('writes needsBy (the Bauherr when the Product has no Product owner), mentions the people asked, and the Inbox filters by it', async () => {
    const { syncGates } = await import('../src/lib/gates')
    const { loadInbox } = await import('../src/app/(app)/lib/inbox')
    const a = await planTicket('a', 'sweep A')
    const aStaging = await releaseTicket('a', 'sweep A staging')
    const prod = await releaseTicket('a', 'sweep A production', { releaseState: 'on_staging', productionState: 'awaiting_approval', labels: ['bauherr:approved:staging'] })
    const b = await planTicket('b', 'sweep B')
    await payload.update({ collection: 'bauherren', id: poOther.id, data: { assignments: [] }, ...o }) // Product B has no Product owner now
    Object.assign(poOther, await payload.findByID({ collection: 'bauherren', id: poOther.id, depth: 0, ...o }))
    await payload.update({ collection: 'products', id: productA, data: { productOwnerTestsStaging: true } as never, ...o })
    await syncGates(payload)
    const by = async (t: { id: number }) => (await reload(t.id)).needsBy ?? null
    expect(await Promise.all([by(a), by(aStaging), by(prod), by(b)])).toEqual(['product-owner', 'product-owner', 'bauherr', 'bauherr'])
    expect((await reload(a.id)).needsYou).toBe('Approve plan')
    expect((await reload(aStaging.id)).needsYou).toBe('Accept on staging')

    // the forge notice mentions the Product owner's login where it asks them, the gate owners (Admin) where it asks the Bauherr
    const notice = async (p: 'a' | 'b', n: string) => (await fake.tickets(REPOS[p]).listComments(n)).find((c) => c.body.startsWith('<!-- bauherr:gate:'))?.body ?? ''
    expect(await notice('a', a.n)).toContain('@the-po')
    expect(await notice('a', a.n)).not.toContain('@the-admin')
    expect(await notice('b', b.n)).toContain('@the-admin')

    const cards = async (user: Record<string, any>) => (await loadInbox(ws, user, {})).groups.flatMap((g) => g.items).map((i) => [i.id, i.asked ?? null])
    expect(await cards(po)).toEqual(expect.arrayContaining([[a.id, null], [aStaging.id, null]]))
    expect((await cards(po)).map(([id]) => id)).not.toEqual(expect.arrayContaining([prod.id]))
    expect((await cards(po)).map(([id]) => id)).not.toContain(b.id)
    expect((await cards(poOther)).length).toBe(0)
    expect(await cards(bauherr)).toEqual(expect.arrayContaining([[a.id, 'product-owner'], [aStaging.id, 'product-owner'], [prod.id, null], [b.id, null]]))
    expect(await cards(admin)).toEqual(await cards(bauherr))
    const decided = await loadInbox(ws, po, { checkpoint: 'Approve plan' })
    expect(decided.groups.flatMap((g) => g.items).map((i) => i.id)).toContain(a.id)
    expect(decided.products.map((p) => p.id)).toEqual([productA])
  })

  it('staging asks nobody for a Product whose switch is off or that has no Product owner: it passes by itself (no acceptance checkpoint)', async () => {
    const { syncGates } = await import('../src/lib/gates')
    const { watchRelease } = await import('../src/lib/release')
    await payload.update({ collection: 'products', id: productA, data: { productOwnerTestsStaging: false } as never, ...o })
    const off = await releaseTicket('a', 'switch off', { releaseState: 'on_staging', productionState: 'awaiting_approval' })
    const unassigned = await releaseTicket('b', 'no owner', { releaseState: 'on_staging' })
    await syncGates(payload)
    expect((await reload(unassigned.id)).needsYou ?? null).toBeNull()
    await watchRelease(payload)
    expect(await labelsOf('b', unassigned.n)).toContain('bauherr:approved:staging')
    expect((await touchesOf(unassigned.id)).map((t) => [t.kind, t.actor])).toEqual([['auto:staging', 'factory']])
    expect((await reload(off.id)).needsYou).toBe('Approve production')
  })
})

describe('a Bauherr\'s forge label on acceptance on staging', () => {
  const STAGING = 'bauherr:approved:staging'
  const labelled = async (p: 'a' | 'b', title: string) => {
    const rel = await releaseTicket(p, title)
    fake.actingAs = 'the-admin'
    await fake.tickets(REPOS[p]).addLabels(rel.n, [STAGING])
    fake.actingAs = 'factory'
    const { verifyGateLabels, GATE_LABELS } = await import('../src/lib/gate-labels')
    const ts = fake.tickets(REPOS[p])
    const verdict = await verifyGateLabels(payload, await reload(rel.id), (await ts.get(rel.n)).labels, ts, GATE_LABELS.filter((g) => g.label === STAGING))
    return { verdict, rejections: (await ts.listComments(rel.n)).filter((c) => c.body.includes('label-rejected')).map((c) => c.body) }
  }

  it('counts where the Product owner is asked for that Product (assigned Product owner, switch on)', async () => {
    await payload.update({ collection: 'products', id: productA, data: { productOwnerTestsStaging: true } as never, ...o })
    const r = await labelled('a', 'label on A')
    expect(r.verdict).toMatchObject({ accepted: [STAGING], rejected: [] })
    expect(r.rejections).toEqual([])
  })

  it('is still rejected with the "gate is off" note where the Product has no acceptance checkpoint (no Product owner, or the switch off)', async () => {
    const noOwner = await labelled('b', 'label on B')
    expect(noOwner.verdict).toMatchObject({ accepted: [], rejected: [STAGING] })
    expect(noOwner.rejections[0]).toContain('gate is off')
    await payload.update({ collection: 'products', id: productA, data: { productOwnerTestsStaging: false } as never, ...o })
    const off = await labelled('a', 'label on A, switch off')
    expect(off.verdict).toMatchObject({ rejected: [STAGING] })
    expect(off.rejections[0]).toContain('gate is off')
  })
})

describe('rows for the Product owner on a checkpoint that asks the Bauherr (gated-pack)', () => {
  const SHEET = '<!-- bauherr:triage -->\n## Questions\nTriage needs your answers.\n\n## Decisions\n- **D1** Pricing? Alternatives: free. Default: paid. critical: true.\n- **D2** Wording? Alternatives: formal. Default: friendly. critical: true. for: product-owner.\n'
  const held = async (p: 'a' | 'b', title: string, sheet = SHEET) => {
    const issue = await fake.tickets(REPOS[p]).create({ title, labels: ['bauherr:needs-refinement'] })
    await fake.tickets(REPOS[p]).comment(String(issue.number), sheet)
    const t = await payload.create({ collection: 'tickets', data: { title, externalId: `${p}${issue.number}`, number: issue.number, url: issue.url, state: 'open', stage: null, labels: ['bauherr:needs-refinement'], product: product(p), workspace: ws }, ...o })
    const { storeOpenCritical } = await import('../src/lib/gates')
    await storeOpenCritical(payload, t.id, await fake.tickets(REPOS[p]).listComments(String(issue.number)))
    return { id: t.id as number, n: String(issue.number) }
  }

  it('stores the open rows; the Product owner\'s Inbox and badge list the Ticket although it asks the Bauherr, only for their Products', async () => {
    usePack('gated-pack')
    try {
      await payload.update({ collection: 'bauherren', id: poOther.id, data: { assignments: [{ workspace: ws, scope: 'products', products: [productB] }] } as never, ...o })
      Object.assign(poOther, await payload.findByID({ collection: 'bauherren', id: poOther.id, depth: 0, ...o }))
      const a = await held('a', 'rows A')
      const none = await held('a', 'no rows for the owner', SHEET.replace(' for: product-owner.', ''))
      const b = await held('b', 'rows B')
      const { syncGates } = await import('../src/lib/gates')
      await syncGates(payload)
      expect(await Promise.all([a, none, b].map(async (t) => [(await reload(t.id)).needsBy, (await reload(t.id)).openOwnerRows]))).toEqual([['bauherr', 1], ['bauherr', 0], ['bauherr', 1]])
      const { loadInbox } = await import('../src/app/(app)/lib/inbox')
      const ids = async (u: Record<string, any>) => (await loadInbox(ws, u, {})).groups.flatMap((g) => g.items).map((i) => i.id)
      const mine = await ids(po)
      expect(mine).toContain(a.id)
      expect(mine).not.toContain(none.id)
      expect(mine).not.toContain(b.id)
      expect(await ids(poOther)).toEqual(expect.arrayContaining([b.id]))
      expect(await ids(poOther)).not.toContain(a.id)
      expect(await ids(bauherr)).toEqual(expect.arrayContaining([a.id, none.id, b.id]))
      // the badge: the same `where` as the layout's count
      const { asksOwner } = await import('../src/lib/addressee')
      const { productScope } = await import('../src/lib/people')
      const badge = (u: Record<string, any>) => payload.count({ collection: 'tickets', where: { and: [{ workspace: { equals: ws } }, { state: { equals: 'open' } }, { needsYou: { exists: true } }, asksOwner, productScope(u, ws)] }, ...o }).then((r) => r.totalDocs)
      const [before, beforeOther] = [await badge(po), await badge(poOther)]
      expect(before).toBe((await ids(po)).length)
      expect(beforeOther).toBe((await ids(poOther)).length)
      // answering the row takes the Ticket out again
      const refine = await import('../src/lib/refine/engine')
      await refine.refineOption(payload, po, { ticket: a.id, workspaceId: ws, point: 'D2', option: 0 })
      expect((await reload(a.id)).openOwnerRows).toBe(0)
      await syncGates(payload)
      expect(await ids(po)).not.toContain(a.id)
      expect(await badge(po)).toBe(before - 1)

      // the typed turn route follows the same rule as the other refine actions: rows addressed to the person, not the checkpoint's addressee
      const again = await held('a', 'rows A again')
      expect(await refine.hasRows(payload, po, { ticket: again.id, workspaceId: ws })).toBe(true)
      expect(await refine.hasRows(payload, po, { ticket: none.id, workspaceId: ws })).toBe(false)
      expect(await refine.hasRows(payload, po, { ticket: b.id, workspaceId: ws })).toBe(false)
      expect(await refine.hasRows(payload, bauherr, { ticket: none.id, workspaceId: ws })).toBe(true)
      const { signSession } = await import('../src/lib/oidc-session')
      const { POST } = await import('../src/app/api/refine/[ticket]/turn/route')
      const turn = async (ticket: number) => {
        const res = await POST(new Request('http://t/x', { method: 'POST', headers: { cookie: `bauherr-session=${signSession(po.id, 0)}`, 'content-type': 'application/json' }, body: JSON.stringify({ recheck: { point: 'D2' } }) }), { params: Promise.resolve({ ticket: String(ticket) }) })
        await res.body?.cancel()
        return res.status
      }
      expect(await Promise.all([turn(again.id), turn(none.id), turn(b.id)])).toEqual([200, 404, 404])
    } finally {
      usePack('owner-pack')
    }
  })
})
