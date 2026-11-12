import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ModelCall } from '../src/lib/chat/stream'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let user: Record<string, any>
let ws: number
let plan: number
let hold: number
let actions: typeof import('../src/lib/actions')
let refine: typeof import('../src/lib/refine/engine')
const o = { overrideAccess: true } as const

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('refine_engine')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  actions = await import('../src/lib/actions')
  refine = await import('../src/lib/refine/engine')
  user = await payload.create({ collection: 'bauherren', data: { email: 'a@x.io', password: 'pw-123456', role: 'admin' }, ...o })
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  const product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo: 'acme/web', product, connection, workspace: ws }, ...o })
  const t = (n: number, title: string, stage: string | null, labels: string[]) => payload.create({ collection: 'tickets', data: { title, externalId: `e2e-${n}`, number: n, url: `https://x/${n}`, state: 'open', labels, stage, product, workspace: ws }, ...o }).then((x) => x.id as number)
  plan = await t(1, 'Add a dark theme to the dashboard', 'plan', []) // forge #1: plan sheet D1 (not critical), D2 (critical)
  hold = await t(14, 'Clarify the export scope', null, ['bauherr:needs-refinement']) // forge #14: Triage hold, D1 critical
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const w = () => ({ ticket: plan, workspaceId: ws })
const comments = async (id: number) => {
  const { ts, n } = await actions.sourceOf(payload, await actions.loadTicket(payload, user, id))
  return (await ts.listComments(n)).map((c) => c.body)
}
const decisions = async (id: number) => (await comments(id)).filter((b) => b.startsWith('<!-- bauherr:decisions -->'))

/** A model that ends the turn with one `refine` call; `calls` counts how often it was asked. */
const scripted = (...results: unknown[]) => {
  const calls = vi.fn()
  const model: ModelCall = async function* (a) {
    calls(a)
    yield { type: 'tool_use', id: `t${calls.mock.calls.length}`, name: 'refine', input: (results[Math.min(calls.mock.calls.length, results.length) - 1] ?? results.at(-1)) as Record<string, unknown> }
    yield { type: 'usage', tokensIn: 5, tokensOut: 7, model: 'm-1' }
  }
  return { model, calls }
}
const ok = (r: Record<string, unknown>) => ({ reply: 'Noted.', settled: [], dropped: [], added: [], next: 'ask', ...r })
const messageCount = async (thread: number) => (await payload.count({ collection: 'chat_messages', where: { thread: { equals: thread } }, ...o })).totalDocs

describe('on a plan sheet with D2 critical and D1', () => {
  it('opens with Triage as the first speaker and the critical point asked first', async () => {
    const v = (await refine.loadRefine(payload, user, w()))!
    expect(v.points.map((p) => [p.id, p.status])).toEqual([['D2', 'open'], ['D1', 'open']])
    expect(v.messages).toHaveLength(1)
    expect(v.messages[0]).toMatchObject({ role: 'assistant', speaker: { kind: 'session', role: expect.stringContaining('Triage') } })
    expect(v.messages[0]!.text).toContain('Follow the system setting')
    expect(v.strip).toMatchObject({ assistant: 'Factory assistant' })
    expect((await refine.loadRefine(payload, user, w()))!.messages).toHaveLength(1) // resuming does not seed again
  })

  it('an invalid result, after one retry, changes nothing: no Comment, no message, the person gets the error', async () => {
    const { model, calls } = scripted({ reply: '', settled: [], dropped: [], added: [], next: 'ask' })
    const before = (await refine.loadRefine(payload, user, w()))!
    await expect(refine.refineTurn(payload, user, { ...w(), text: 'whatever', model })).rejects.toThrow('invalid refine result')
    expect(calls).toHaveBeenCalledTimes(2)
    expect(await decisions(plan)).toEqual([])
    expect((await refine.loadRefine(payload, user, w()))!.messages).toHaveLength(before.messages.length)
  })

  it('a result naming an unknown point is invalid as a whole: the valid part is not applied either', async () => {
    const { model } = scripted(ok({ settled: [{ id: 'D2', answer: 'yes' }, { id: 'D9', answer: 'x' }] }))
    await expect(refine.refineTurn(payload, user, { ...w(), text: 'x', model })).rejects.toThrow('unknown or repeated')
    expect(await decisions(plan)).toEqual([])
  })

  it('"Why does this matter?" answers from the stored reason, an option click records without a model, and neither reaches the helper thread', async () => {
    const before = await comments(plan)
    const why = await refine.refineWhy(payload, user, { ...w(), point: 'D2' })
    expect(why.messages.at(-1)).toMatchObject({ role: 'assistant', speaker: { kind: 'assistant', model: null } })
    expect(await comments(plan)).toEqual(before)
    const v = await refine.refineOption(payload, user, { ...w(), point: 'D2', option: 1 })
    expect(v.points.find((p) => p.id === 'D2')).toMatchObject({ status: 'answered', answer: 'never, always light first' })
    expect(v.messages.at(-1)!.text).toContain('Where to store the choice')
    expect((await decisions(plan))[0]).toContain('D2: never, always light first')
    expect((await comments(plan)).find((b) => b.startsWith('<!-- bauherr:worklog -->'))).toContain('D2 Follow the system setting: never, always light first')
    expect(await payload.count({ collection: 'chat_threads', where: { ticket: { equals: plan } }, ...o })).toMatchObject({ totalDocs: 0 })
  })

  it('"Change" opens an answered point again', async () => {
    const v = await refine.refineReopen(payload, user, { ...w(), point: 'D2' })
    expect(v.points.find((p) => p.id === 'D2')!.status).toBe('open')
    expect((await decisions(plan))[0]).not.toContain('D2:')
  })

  it('one free-text message settles two points, drops a third and adds a new one, and the Comment stays one', async () => {
    const { model } = scripted(ok({ reply: 'Both are settled; one new question.', settled: [{ id: 'D2', answer: 'follow the system' }, { id: 'D1', answer: 'localStorage' }], added: [{ question: 'Which key name', options: ['theme', 'ui-theme'], default: 'theme', why: 'Other code reads it' }], ticket: { title: 'Dark theme, remembered' } }))
    expect(await decisions(plan)).toHaveLength(1)
    const v = await refine.refineTurn(payload, user, { ...w(), text: 'follow the system, store it in localStorage', model })
    expect(v.points.map((p) => [p.id, p.status, p.source])).toEqual([['D2', 'answered', 'triage'], ['D1', 'answered', 'triage'], ['D3', 'open', 'conversation']])
    expect(await decisions(plan)).toHaveLength(1)
    const body = (await decisions(plan))[0]!
    expect(body).toContain('D2: follow the system')
    expect(body).toContain('D1: localStorage')
    expect(body).toContain('## Decisions\n- **D3** Which key name')
    expect(v.messages.slice(-2).map((m) => [m.role, m.speaker.model ?? null, m.speaker.kind])).toEqual([['user', null, 'person'], ['assistant', 'm-1', 'assistant']])
    expect(v.summary).toBeNull()
  })

  it('the ticket text edit is kept for the end; typed text never touched the helper thread', async () => {
    expect((await refine.loadRefine(payload, user, w()))!.summary).toBeNull()
    expect(await payload.count({ collection: 'chat_threads', where: { ticket: { equals: plan } }, ...o })).toMatchObject({ totalDocs: 0 })
    const { totalDocs } = await payload.count({ collection: 'chat_messages', where: { 'thread.ticket': { equals: plan } }, ...o })
    expect(totalDocs).toBe(0)
  })

  it('"Use the recommended answers for the rest" settles the rest in one step and the summary is next', async () => {
    const v = await refine.refineRecommended(payload, user, w())
    expect(v.points.find((p) => p.id === 'D3')).toMatchObject({ status: 'answered', answer: 'theme' })
    expect(v.summary).toMatchObject({ decided: [expect.objectContaining({ id: 'D2' }), expect.objectContaining({ id: 'D1' }), expect.objectContaining({ id: 'D3', answer: 'theme' })], title: { to: 'Dark theme, remembered' } })
    await expect(refine.refineRecommended(payload, user, w())).rejects.toThrow('no open point')
  })

  it('a dropped point reads as dropped and the summary lists it', async () => {
    const { model } = scripted(ok({ reply: 'Fine.', added: [{ question: 'Extra?', options: ['a'], default: 'a' }] }), ok({ reply: 'Pointless now.', dropped: [{ id: 'D4', reason: 'we skip it' }] }))
    await refine.refineTurn(payload, user, { ...w(), text: 'one more thing', model })
    const v = await refine.refineTurn(payload, user, { ...w(), text: 'never mind that', model })
    expect(v.points.find((p) => p.id === 'D4')).toMatchObject({ status: 'dropped', answer: 'we skip it' })
    expect((await decisions(plan))[0]).toContain('D4: (no longer needed) we skip it')
    expect(v.summary!.decided.find((d) => d.id === 'D4')).toMatchObject({ dropped: true })
  })

  it('the model never receives a message of the panel as the helper does: the call forces the refine tool and carries the person text in <person>', async () => {
    const { model, calls } = scripted(ok({ reply: 'ok', added: [{ question: 'Again?' }] }))
    await refine.refineTurn(payload, user, { ...w(), text: 'hello there', model })
    const a = calls.mock.calls[0]![0]
    expect(a.forceTool).toBe('refine')
    expect(a.tools.map((t: { name: string }) => t.name)).toEqual(['refine'])
    expect(JSON.stringify(a.messages.at(-1))).toContain('<person>hello there</person>')
    expect(a.system).not.toContain('hello there')
  })

  it('caps the length and the number of typed messages', async () => {
    const { model } = scripted(ok({}))
    await expect(refine.refineTurn(payload, user, { ...w(), text: 'x'.repeat(2001), model })).rejects.toThrow('longer than')
    await expect(refine.refineTurn(payload, user, { ...w(), text: '   ', model })).rejects.toThrow('empty')
  })

  it('refuses a Ticket of another Workspace', async () => {
    await expect(refine.loadRefine(payload, user, { ticket: plan, workspaceId: ws + 99 })).rejects.toBeInstanceOf(actions.NotInWorkspace)
  })
})

describe('on a Triage hold', () => {
  const h = () => ({ ticket: hold, workspaceId: ws })
  const labels = async () => {
    const { ts, n } = await actions.sourceOf(payload, await actions.loadTicket(payload, user, hold))
    return (await ts.get(n)).labels
  }

  it('answering the last row does not release the hold; sending does, the way the last decision row does, and the conversation becomes history', async () => {
    const { model } = scripted(ok({ reply: 'Thanks.', settled: [{ id: 'D1', answer: 'XLSX' }], ticket: { body: 'Export as XLSX.' } }))
    const v = await refine.refineTurn(payload, user, { ...h(), text: 'XLSX please', model })
    expect(v.summary).not.toBeNull()
    expect(v.hold).toBe(true)
    expect(await labels()).toContain('bauherr:needs-refinement')
    await expect(refine.refineSend(payload, user, { ...h(), workspaceId: ws })).resolves.toMatchObject({ sent: true })
    expect(await labels()).not.toContain('bauherr:needs-refinement')
    const { ts, n } = await actions.sourceOf(payload, await actions.loadTicket(payload, user, hold))
    expect((await ts.get(n)).body).toBe('Export as XLSX.')
    await expect(refine.refineTurn(payload, user, { ...h(), text: 'more', model })).rejects.toThrow('read-only')
    const again = (await refine.loadRefine(payload, user, h()))!
    expect(again).toMatchObject({ sent: true })
    expect(again.messages.length).toBeGreaterThan(2)
  })

  it('sending with a point still open is refused', async () => {
    await expect(refine.refineSend(payload, user, w())).rejects.toThrow('still open')
  })
})
