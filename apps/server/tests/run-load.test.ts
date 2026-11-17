import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') } }))

let payload: Payload
let testDb: TestDb
let loadRun: typeof import('../src/app/(app)/lib/run').loadRun
let ws: number
let runId: number
let strangerRun: number
let sessionPublicId: string
const o = { overrideAccess: true } as const

beforeAll(async () => {
  testDb = await createTestDb('runload')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  await (await import('../src/lib/factory')).loadWorkflows(payload)
  loadRun = (await import('../src/app/(app)/lib/run')).loadRun
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  const other = (await payload.create({ collection: 'workspaces', data: { name: 'other', slug: 'other' }, ...o })).id as number
  const product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const otherProduct = (await payload.create({ collection: 'products', data: { name: 'oweb', slug: 'oweb', workspace: other }, ...o })).id as number
  const owner = await payload.create({ collection: 'bauherren', data: { email: 'owner-secret@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
  const session = await payload.create({ collection: 'agent_sessions', data: { publicId: 'sess-1', role: 'engineer', label: 'eng-2a1', clientName: 'claude-code', clientVersion: '2.1.0', model: 'sonnet-x', provider: 'anthropic', lastSeenAt: new Date().toISOString(), workspace: ws }, ...o })
  sessionPublicId = session.publicId as string
  const ticket = await payload.create({ collection: 'tickets', data: { title: 'Add export', externalId: 'rl-1', number: 1, state: 'open', labels: [], stage: 'build', product, workspace: ws, waitingFor: 'checks' }, ...o })
  const otherTicket = await payload.create({ collection: 'tickets', data: { title: 'x', externalId: 'rl-2', number: 2, state: 'open', labels: [], stage: 'build', product: otherProduct, workspace: other }, ...o })
  strangerRun = (await payload.create({ collection: 'runs', data: { ticket: otherTicket.id, stage: 'build', mode: 'session', status: 'failed', workspace: other }, ...o })).id as number
  const prev = await payload.create({ collection: 'runs', data: { ticket: ticket.id, stage: 'build', mode: 'session', status: 'abandoned', workspace: ws }, ...o })
  const run = await payload.create({
    collection: 'runs',
    data: { ticket: ticket.id, stage: 'build', mode: 'session', status: 'running', workspace: ws, session: session.id, sessionOwner: owner.id, sessionLabel: 'eng-2a1', heartbeatAt: new Date().toISOString(), previousRun: prev.id, model: 'sonnet-x', provider: 'anthropic', clientName: 'claude-code', clientVersion: '2.1.0', tokensIn: 10, tokensOut: 5, costUsd: 1.23, costSource: 'gateway', escalation: { step: 2, reason: 'r', previousRuns: [prev.id, strangerRun] }, goal: ['secret goal'], evidence: '| Plan step | done/deferred | Evidence or reason |\n|---|---|---|\n| 1 | done | ok |' },
    ...o,
  })
  runId = run.id as number
  await payload.create({ collection: 'steps', data: { run: runId, workspace: ws, seq: 1, summary: 'Wired the button', tokensIn: 99, tokensOut: 98, costEstimateUsd: 0.5, startedAt: new Date().toISOString() }, ...o })
  await payload.create({ collection: 'usage_entries', data: { run: runId, model: 'sonnet-x', source: 'gateway', tokensIn: 10, tokensOut: 5, costUsd: 1.23, at: new Date().toISOString(), workspace: ws }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

it('a non-Admin gets Step summaries, the session role and liveness, and no Admin data', async () => {
  const r = await loadRun(ws, String(runId), false)
  expect(r.steps).toEqual([expect.objectContaining({ seq: 1, summary: 'Wired the button' })])
  expect(r.session).toMatchObject({ label: 'eng-2a1', role: 'engineer', publicId: sessionPublicId })
  expect(r.ticket).toMatchObject({ waitingFor: 'checks' })
  expect(r.admin).toBeNull()
  const json = JSON.stringify(r)
  for (const leak of ['tokens', 'costUsd', 'model', 'provider', 'clientVersion', 'clientName', 'owner-secret@x.io', 'secret goal', 'sonnet-x', 'gateway']) expect(json, leak).not.toContain(leak)
})

it('an Admin gets the full Run and, under one key, owner, usage and tool calls', async () => {
  const r = await loadRun(ws, String(runId), true)
  expect(r.run).toMatchObject({ model: 'sonnet-x', tokensIn: 10 })
  expect(r.session).toMatchObject({ clientVersion: '2.1.0', model: 'sonnet-x', provider: 'anthropic' })
  expect(r.steps[0]).toMatchObject({ tokensIn: 99 })
  expect(r.admin).toMatchObject({ owner: 'owner-secret@x.io', usage: [expect.objectContaining({ model: 'sonnet-x', source: 'gateway', costUsd: 1.23 })] })
})

it('relations only link Runs of the Workspace', async () => {
  const { chain } = await loadRun(ws, String(runId), false)
  expect(chain.previous).not.toBeNull()
  expect(chain.escalation).toEqual([chain.previous])
  expect(chain.escalation).not.toContain(strangerRun)
})

it('a Run of another Workspace is not found', async () => {
  await expect(loadRun(ws, String(strangerRun), true)).rejects.toThrow('NOT_FOUND')
})
