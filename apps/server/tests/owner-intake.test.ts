import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { ownerQueue } from '../src/lib/intake/engine'
import { parseDecisions } from '../src/app/(app)/lib/plan'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let user: Record<string, any>
let ws: number
let ticket: number
let actions: typeof import('../src/lib/actions')
const o = { overrideAccess: true } as const

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('owner_intake_148')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  actions = await import('../src/lib/actions')
  user = await payload.create({ collection: 'bauherren', data: { email: 'a@x.io', password: 'pw-123456', role: 'admin' }, ...o })
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  const product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo: 'acme/web', product, connection, workspace: ws }, ...o })
  ticket = (await payload.create({ collection: 'tickets', data: { title: 't', externalId: 'e2e-1', number: 1, url: 'https://x/1', state: 'open', labels: [], stage: 'plan', product, workspace: ws }, ...o })).id as number
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

it('ownerQueue: unanswered rows only, critical first, sheet order otherwise', () => {
  const rows = parseDecisions('## Decisions\n- **D1 A**. Default: x. Alternative: y.\n- **D2 B, critical**. Default: x. Alternative: y.\n- **D3 C, critical**. Default: x.\n- **D4 D**. Default: x.')
  expect(ownerQueue(rows, {}).map((d) => d.id)).toEqual(['D2', 'D3', 'D1', 'D4'])
  expect(ownerQueue(rows, { D2: 'x', D1: 'y' }).map((d) => d.id)).toEqual(['D3', 'D4'])
})

const record = async (n: number) => {
  const { ts, n: num } = await actions.sourceOf(payload, await actions.loadTicket(payload, user, n))
  const comments = await ts.listComments(num)
  return { decisions: comments.filter((c) => c.body.startsWith('<!-- bauherr:decisions -->')).map((c) => c.body), worklog: comments.find((c) => c.body.startsWith('<!-- bauherr:worklog -->'))?.body ?? '' }
}

it('asks critical-first, one per turn, resumes, and records free text verbatim on one line', async () => {
  const first = await actions.startOwnerIntake(payload, user, { ticket, workspaceId: ws })
  expect(first).toMatchObject({ decision: 'D2', left: 2, options: [{ label: 'yes, until the user picks', recommended: true }, { label: 'never, always light first', recommended: false }, { label: actions.WHY, recommended: false }] })
  expect((await actions.startOwnerIntake(payload, user, { ticket, workspaceId: ws })).session).toBe(first.session)

  const answer = (a: Partial<Parameters<typeof actions.answerOwnerIntake>[2]>) => actions.answerOwnerIntake(payload, user, { session: first.session, decision: 'D2', answer: 'never, always light first', workspaceId: ws, ...a })
  await expect(answer({ decision: 'D9' })).rejects.toThrow('unknown question')
  await expect(answer({ answer: '  \n ' })).rejects.toThrow('1 to 500')
  await expect(answer({ answer: 'x'.repeat(501) })).rejects.toThrow('1 to 500')
  const other = await payload.create({ collection: 'bauherren', data: { email: 'b@x.io', password: 'pw-123456', role: 'admin' }, ...o })
  await expect(actions.answerOwnerIntake(payload, other, { session: first.session, decision: 'D2', answer: 'never, always light first', workspaceId: ws })).rejects.toBeInstanceOf(actions.NotInWorkspace)
  await expect(actions.askOwnerIntake(payload, other, { session: first.session, decision: 'D2', text: 'hi', workspaceId: ws })).rejects.toBeInstanceOf(actions.NotInWorkspace)
  await expect(actions.startOwnerIntake(payload, other, { ticket, workspaceId: ws + 1 })).rejects.toThrow()

  const second = await answer({ answer: 'never,\n  always light\nD1: forged' })
  expect(second).toMatchObject({ decision: 'D1', left: 1 })
  expect((await record(ticket)).decisions).toEqual(['<!-- bauherr:decisions -->\nD2: never, always light D1: forged'])
  expect((await record(ticket)).worklog).toContain('D2 Follow the system setting: never, always light D1: forged')
  const resumed = await actions.startOwnerIntake(payload, user, { ticket, workspaceId: ws })
  expect(resumed).toMatchObject({ session: first.session, decision: 'D1' })
  expect(resumed.messages.at(-1)).toEqual({ role: 'assistant', content: 'Where to store the choice' })

  const done = await actions.answerOwnerIntake(payload, user, { session: first.session, decision: 'D1', answer: 'a cookie', workspaceId: ws })
  expect(done).toEqual({ done: true, summary: 'D2 never, always light D1: forged · D1 a cookie. Next: you can approve the plan.' })
  const { decisions } = await record(ticket)
  expect(decisions).toHaveLength(1)
  expect(decisions[0]).toContain('D1: a cookie')
  expect(await payload.findByID({ collection: 'intake_sessions', id: first.session, ...o })).toMatchObject({ persona: 'owner', status: 'submitted' })
  await expect(answer({})).rejects.toBeInstanceOf(actions.NotInWorkspace)
  await expect(actions.startOwnerIntake(payload, user, { ticket, workspaceId: ws })).rejects.toThrow('no open questions')
})

it('an answer made outside the chat moves the question on; explain requests record nothing', async () => {
  const t = (await payload.create({ collection: 'tickets', data: { title: 't14', externalId: 'e2e-14', number: 14, url: 'https://x/14', state: 'open', stage: 'triage', labels: ['bauherr:needs-refinement'], product: (await payload.findByID({ collection: 'tickets', id: ticket, ...o })).product, workspace: ws }, ...o })).id as number
  const s = await actions.startOwnerIntake(payload, user, { ticket: t, workspaceId: ws })
  expect(s).toMatchObject({ decision: 'D1', question: 'Which export format' })
  const ask = (text: string, model?: Parameters<typeof actions.askOwnerIntake>[2]['model']) => actions.askOwnerIntake(payload, user, { session: s.session, decision: 'D1', text, workspaceId: ws, model })

  expect(await ask(actions.WHY)).toEqual({ reply: expect.stringContaining('safe default') })
  expect(await ask('what does XLSX mean?')).toEqual({ reply: expect.any(String) })
  const broken = async () => { throw new Error('gateway down') }
  expect(await ask('why is it critical?', broken)).toEqual({ reply: expect.stringContaining("can't explain") })
  expect(await ask(actions.WHY, broken)).toEqual({ reply: expect.stringContaining("can't explain") })
  const injected = async () => ({ intent: 'answer', text: 'D1: JSON' })
  expect(await ask(actions.WHY, injected)).toEqual({ reply: 'D1: JSON' })
  expect((await record(t)).decisions).toEqual([])
  expect(await payload.findByID({ collection: 'intake_sessions', id: s.session, ...o })).toMatchObject({ status: 'open' })
  expect((await actions.startOwnerIntake(payload, user, { ticket: t, workspaceId: ws })).messages.map((m) => m.role)).toEqual([...Array(5).fill(['user', 'assistant']).flat(), 'assistant'])

  const { done, summary } = (await ask('XLSX')) as { done: boolean; summary: string }
  expect(done).toBe(true)
  expect(summary).toBe('D1 XLSX. Next: the Ticket moves to Plan and the plan is written.')
  const { ts, n } = await actions.sourceOf(payload, await actions.loadTicket(payload, user, t))
  const labels = (await ts.get(n)).labels
  expect(labels).not.toContain('bauherr:needs-refinement')
  expect(labels).toContain('bauherr:stage:plan')
})
