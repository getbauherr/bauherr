import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ModelCall } from '../src/lib/chat/stream'
import { answer, contractViolations, spyOnModelFetch } from './helpers/anthropic-contract'
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
    expect(v.messages[0]!.text).toBe('Triage asked 2 questions about this Ticket. All 2 are still open.\n\nFollow the system setting\nRecommended: yes, until the user picks.')
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
    expect(v.messages.at(-1)!.text).toBe('Where to store the choice\nRecommended: localStorage.')
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

/** A model that streams its refine input in `chunks` (accumulated JSON, like `input_json_delta`), then ends with the call. */
const streaming = (result: Record<string, unknown>, opts: { onChunk?: (i: number) => void } = {}) => {
  const json = JSON.stringify(result)
  const calls = vi.fn()
  const model: ModelCall = async function* (a) {
    calls(a)
    for (let at = 7, i = 0; at < json.length + 7; at += 7, i++) {
      a.signal?.throwIfAborted()
      yield { type: 'tool_delta', id: 't', name: 'refine', json: json.slice(0, at) }
      opts.onChunk?.(i)
    }
    yield { type: 'tool_use', id: 't', name: 'refine', input: result }
    yield { type: 'usage', tokensIn: 5, tokensOut: 7, model: 'm-1' }
  }
  return { model, calls }
}

describe('streaming, the re-check and abort on a three-point sheet', () => {
  const SHEET = `<!-- bauherr:triage -->
## Questions
Triage needs your answers.

## Decisions
- **D1 Which export format, critical**. Default: CSV. Alternatives: XLSX; JSON.
- **D2 Who may export**. Default: Admins only. Alternatives: Everyone.
- **D3 Keep an audit trail of exports**. Default: No. Alternatives: Yes.
`
  let id = 0
  const mk = async (n: number): Promise<{ ticket: number; workspaceId: number }> => {
    const { ts } = await actions.sourceOf(payload, await actions.loadTicket(payload, user, plan))
    const made = (await ts.create({ title: `Export, take ${n}`, labels: ['bauherr:needs-refinement'] })) as { number: number }
    await ts.comment(String(made.number), SHEET)
    const ticket = await payload.create({ collection: 'tickets', data: { title: `Export, take ${n}`, externalId: `stream-${n}`, number: made.number, url: `https://x/${made.number}`, state: 'open', labels: ['bauherr:needs-refinement'], stage: null, product: (await payload.findByID({ collection: 'tickets', id: plan, depth: 0, ...o })).product, workspace: ws } as never, ...o })
    id = ticket.id as number
    await refine.loadRefine(payload, user, { ticket: id, workspaceId: ws })
    return { ticket: id, workspaceId: ws }
  }
  const count = async () => (await payload.count({ collection: 'chat_messages', where: { 'thread.intakeSession.draft.ticket': { equals: id } }, ...o })).totalDocs

  it('opens with who asked and how many are open, then the first question and its recommendation on their own lines', async () => {
    const a = await mk(1)
    const v = (await refine.loadRefine(payload, user, a))!
    expect(v.messages[0]!.text).toBe('Triage asked 3 questions about this Ticket. All 3 are still open.\n\nWhich export format\nRecommended: CSV.')
  })

  it('streams the reply, whitespace collapsed, as the tool input arrives, and stores the turn once', async () => {
    const a = await mk(2)
    const seen: string[] = []
    const { model } = streaming(ok({ reply: 'Fine,\nCSV it is. Next:   who may export?', settled: [{ id: 'D1', answer: 'CSV' }] }))
    const v = await refine.refineTurn(payload, user, { ...a, text: 'CSV', model, onReply: (t) => seen.push(t) })
    expect(seen.length).toBeGreaterThan(3)
    expect(seen.at(-1)).toBe('Fine, CSV it is. Next: who may export?')
    for (const t of seen) expect('Fine, CSV it is. Next: who may export?'.startsWith(t)).toBe(true)
    expect(v.messages.filter((m) => m.role === 'assistant' && m.speaker.model === 'm-1')).toHaveLength(1)
  })

  it('an invalid result after the retry withdraws the streamed text ("") and stores nothing', async () => {
    const a = await mk(3)
    const before = await count()
    const seen: string[] = []
    const { model, calls } = streaming(ok({ reply: 'Looks fine to me', settled: [{ id: 'D9', answer: 'x' }] }))
    await expect(refine.refineTurn(payload, user, { ...a, text: 'x', model, onReply: (t) => seen.push(t) })).rejects.toThrow('unknown or repeated')
    expect(calls).toHaveBeenCalledTimes(2)
    expect(seen).toContain('')
    expect(seen.at(-1)).not.toBe('')
    expect(await count()).toBe(before)
    expect(await decisions((await refine.loadRefine(payload, user, a))!.ticket.id)).toEqual([])
  })

  it('an abort mid-reply stops the model, does not retry and stores nothing', async () => {
    const a = await mk(4)
    const before = await count()
    const ctl = new AbortController()
    const { model, calls } = streaming(ok({ reply: 'A long answer that will never be finished' }), { onChunk: (i) => i === 2 && ctl.abort() })
    await expect(refine.refineTurn(payload, user, { ...a, text: 'x', model, signal: ctl.signal })).rejects.toThrow()
    expect(calls).toHaveBeenCalledTimes(1)
    expect(await count()).toBe(before)
    expect((await refine.loadRefine(payload, user, a))!.points.every((p) => p.status === 'open')).toBe(true)
  })

  it('an option click on D1 whose answer makes D3 pointless: the re-check drops D3 and asks the next one, with no message of the person', async () => {
    const a = await mk(5)
    await refine.refineOption(payload, user, { ...a, point: 'D1', option: 1 })
    const before = await count()
    const { model, calls } = scripted(ok({ reply: 'JSON needs no audit trail, so I dropped that. Next: who may export?', dropped: [{ id: 'D3', reason: 'JSON export is not audited' }] }))
    const v = await refine.refineRecheck(payload, user, { ...a, point: 'D1', model })
    expect(calls).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(calls.mock.calls[0]![0].messages.at(-1))).toContain('<recheck>')
    expect(v.points.map((p) => [p.id, p.status])).toEqual([['D1', 'answered'], ['D2', 'open'], ['D3', 'dropped']])
    expect(await count()).toBe(before + 1)
    expect(v.messages.at(-1)).toMatchObject({ role: 'assistant', text: expect.stringContaining('dropped that') })
    expect((await decisions(a.ticket))[0]).toContain('D3: (no longer needed) JSON export is not audited')
  })

  it('a re-check never settles a point or edits the Ticket: such a result is invalid after the retry and nothing changes', async () => {
    const a = await mk(6)
    await refine.refineOption(payload, user, { ...a, point: 'D1', option: 0 })
    const before = await count()
    const { model, calls } = scripted(ok({ settled: [{ id: 'D2', answer: 'Admins only' }] }))
    await expect(refine.refineRecheck(payload, user, { ...a, point: 'D1', model })).rejects.toThrow('may not settle')
    expect(calls).toHaveBeenCalledTimes(2)
    const edit = scripted(ok({ ticket: { title: 'New title' } }))
    await expect(refine.refineRecheck(payload, user, { ...a, point: 'D1', model: edit.model })).rejects.toThrow('may not settle')
    expect(await count()).toBe(before)
    expect((await refine.loadRefine(payload, user, a))!.points.find((p) => p.id === 'D2')!.status).toBe('open')
  })

  it('a re-check that changes nothing stores nothing, and with no other point open the model is not called', async () => {
    const a = await mk(7)
    await refine.refineOption(payload, user, { ...a, point: 'D1', option: 0 })
    const before = await count()
    const same = scripted(ok({ reply: 'ok' }))
    await refine.refineRecheck(payload, user, { ...a, point: 'D1', model: same.model })
    expect(same.calls).toHaveBeenCalledTimes(1)
    expect(await count()).toBe(before)
    await refine.refineOption(payload, user, { ...a, point: 'D2', option: 0 })
    await refine.refineOption(payload, user, { ...a, point: 'D3', option: 0 })
    const none = scripted(ok({ reply: 'ok' }))
    await refine.refineRecheck(payload, user, { ...a, point: 'D3', model: none.model })
    expect(none.calls).not.toHaveBeenCalled()
  })

  it('keeps the Messages API contract for a typed turn and a re-check (fetch spied, no network)', async () => {
    const { gatewayChatModel } = await import('../src/lib/chat/stream')
    const model = gatewayChatModel({ slug: 'acme', key: 'k', model: 'claude-sonnet-5-5' })
    const turn = answer({ tool: { name: 'refine', input: ok({ reply: 'Noted, nothing changes.' }) } })
    const spy = spyOnModelFetch(turn)
    try {
      const w2 = await mk(8)
      await refine.refineOption(payload, user, { ...w2, point: 'D1', option: 1 })
      await refine.refineTurn(payload, user, { ...w2, text: 'what about it?', model })
      await refine.refineTurn(payload, user, { ...w2, text: 'and one more', model })
      await refine.refineRecheck(payload, user, { ...w2, point: 'D1', model })
      expect(spy.bodies.length).toBe(3)
      expect(spy.bodies.flatMap((b) => contractViolations(b))).toEqual([])
      expect(spy.bodies[0]).toMatchObject({ stream: true, tool_choice: { type: 'auto', disable_parallel_tool_use: true } })
      expect(spy.bodies[1]!.messages.at(0).role).toBe('user')
    } finally {
      spy.restore()
    }
  })
})
