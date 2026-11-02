import pg from 'pg'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { ownerQueue } from '../src/lib/intake/engine'
import { parseDecisions } from '../src/app/(app)/lib/plan'

let payload: Payload
let user: Record<string, any>
let ws: number
let ticket: number
let actions: typeof import('../src/lib/actions')
const o = { overrideAccess: true } as const

beforeAll(async () => {
  const base = process.env.DATABASE_URL ?? 'postgres://bauherr:bauherr@127.0.0.1:54330/bauherr'
  const admin = new pg.Client({ connectionString: base })
  await admin.connect()
  await admin.query('DROP DATABASE IF EXISTS bauherr_test_owner_intake_148 WITH (FORCE)')
  await admin.query('CREATE DATABASE bauherr_test_owner_intake_148')
  await admin.end()
  process.env.DATABASE_URL = base.replace(/\/[^/]+$/, '/bauherr_test_owner_intake_148')
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
})

it('ownerQueue: unanswered rows only, critical first, sheet order otherwise', () => {
  const rows = parseDecisions('## Decisions\n- **D1 A**. Default: x. Alternative: y.\n- **D2 B, critical**. Default: x. Alternative: y.\n- **D3 C, critical**. Default: x.\n- **D4 D**. Default: x.')
  expect(ownerQueue(rows, {}).map((d) => d.id)).toEqual(['D2', 'D3', 'D1', 'D4'])
  expect(ownerQueue(rows, { D2: 'x', D1: 'y' }).map((d) => d.id)).toEqual(['D3', 'D4'])
})

it('asks critical-first, one per turn, and the answers land as Decisions', async () => {
  const first = await actions.startOwnerIntake(payload, user, { ticket, workspaceId: ws })
  expect(first).toMatchObject({ decision: 'D2', left: 2, options: [{ label: 'yes, until the user picks', recommended: true }, { label: 'never, always light first', recommended: false }] })

  const answer = (a: Partial<Parameters<typeof actions.answerOwnerIntake>[2]>) => actions.answerOwnerIntake(payload, user, { session: first.session, decision: 'D2', answer: 'never, always light first', workspaceId: ws, ...a })
  await expect(answer({ answer: 'something else' })).rejects.toThrow('unknown question or option')
  await expect(answer({ decision: 'D9' })).rejects.toThrow('unknown question or option')
  const other = await payload.create({ collection: 'bauherren', data: { email: 'b@x.io', password: 'pw-123456', role: 'admin' }, ...o })
  await expect(actions.answerOwnerIntake(payload, other, { session: first.session, decision: 'D2', answer: 'never, always light first', workspaceId: ws })).rejects.toBeInstanceOf(actions.NotInWorkspace)

  const second = await actions.answerOwnerIntake(payload, user, { session: first.session, decision: 'D2', answer: 'never, always light first', workspaceId: ws })
  expect(second).toMatchObject({ decision: 'D1', left: 1 })
  const { ts, n } = await actions.sourceOf(payload, await actions.loadTicket(payload, user, ticket))
  const comments = async () => await ts.listComments(n)
  expect((await comments()).filter((c) => c.body.startsWith('<!-- bauherr:decisions -->')).map((c) => c.body)).toEqual(['<!-- bauherr:decisions -->\nD2: never, always light first'])

  expect(await actions.answerOwnerIntake(payload, user, { session: first.session, decision: 'D1', answer: 'a cookie', workspaceId: ws })).toBeNull()
  const decisions = (await comments()).filter((c) => c.body.startsWith('<!-- bauherr:decisions -->'))
  expect(decisions).toHaveLength(1)
  expect(decisions[0]!.body).toContain('D1: a cookie')
  expect(decisions[0]!.body).toContain('D2: never, always light first')
  expect((await comments()).find((c) => c.body.startsWith('<!-- bauherr:worklog -->'))!.body).toContain('D2 Follow the system setting: never, always light first')
  expect(await payload.findByID({ collection: 'intake_sessions', id: first.session, ...o })).toMatchObject({ persona: 'owner', status: 'submitted' })
  await expect(answer({})).rejects.toBeInstanceOf(actions.NotInWorkspace)
  await expect(actions.startOwnerIntake(payload, user, { ticket, workspaceId: ws })).rejects.toThrow('no open questions')
})

