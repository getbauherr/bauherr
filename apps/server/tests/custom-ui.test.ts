import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

/** A custom agent stage (security) and human stage (signoff), applied to one Workspace, in the Workflow graph, the status line, Path/Steps, Insights and the Inbox. */
let payload: Payload
let fake: FakeBackend
let ws: number
let product: number
let admin: Record<string, any>
const o = { overrideAccess: true } as const
const packDir = fileURLToPath(new URL('./fixtures/custom-pack', import.meta.url))
const repo = 'acme/ui'

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('custom_ui')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'session' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'ui', slug: 'ui', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
  admin = await payload.create({ collection: 'bauherren', data: { email: 'a@x.io', password: 'pw-123456', role: 'admin' }, ...o })
  const { applyFactory } = await import('../src/lib/factory')
  process.env.BAUHERR_PACK_DIR = packDir
  try {
    expect(await applyFactory(payload, ws, readFileSync(`${packDir}/factory.yaml`, 'utf8'), { by: 'a@x.io', via: 'api' })).toMatchObject({ ok: true })
  } finally {
    delete process.env.BAUHERR_PACK_DIR
  }
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const signoffTicket = async (title: string) => {
  const issue = await fake.tickets(repo).create({ title, labels: ['bauherr:stage:signoff'] })
  return (await payload.create({ collection: 'tickets', data: { title, externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage: 'signoff', product, workspace: ws }, ...o })).id as number
}
const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>

it('the Workflow graph has the custom stages with their outcome edges, backward ones marked', async () => {
  const { workflowFor } = await import('../src/lib/factory')
  const { graph } = await import('../src/lib/workflow')
  const g = graph(workflowFor(ws))
  expect(g.nodes.filter((n) => ['security', 'signoff'].includes(n.id))).toEqual([
    { id: 'security', title: 'Security review', kind: 'agent', role: 'security', checkpoint: false },
    { id: 'signoff', title: 'Architecture sign-off', kind: 'human', checkpoint: true },
  ])
  const edge = (from: string, outcome: string) => g.edges.find((e) => e.from === from && e.outcome === outcome)
  expect(edge('build', 'done')).toMatchObject({ to: 'security', back: false })
  expect(edge('security', 'pass')).toMatchObject({ to: 'signoff', back: false })
  expect(edge('security', 'findings')).toMatchObject({ to: 'build', back: true })
  expect(edge('signoff', 'approve')).toMatchObject({ to: 'review', back: false })
  expect(edge('signoff', 'reject')).toMatchObject({ to: 'build', back: true })
})

it('a Ticket on the human stage reads "Waiting for you", sits in the Inbox with the stage outcomes as buttons, and deciding routes it', async () => {
  const { syncGate } = await import('../src/lib/gates')
  const { loadOverviewRows } = await import('../src/app/(app)/lib/overview')
  const { loadInbox } = await import('../src/app/(app)/lib/inbox')
  const { ticketStatus } = await import('../src/app/(app)/lib/status')
  const { workflowFor } = await import('../src/lib/factory')
  const { decide } = await import('../src/lib/actions')
  const { settleDecision } = await import('../src/lib/decision')
  const wf = workflowFor(ws)
  const approve = await signoffTicket('approve me')
  const reject = await signoffTicket('reject me')
  for (const id of [approve, reject]) await syncGate(payload, await reload(id), null)

  expect(await reload(approve)).toMatchObject({ needsYou: 'Decision needed', decision: { need: 'Decision needed', checkpoint: 'Decision', options: [{ label: 'Approve', action: 'decide', outcome: 'approve', primary: true }, { label: 'Reject', action: 'decide', outcome: 'reject' }] } })
  const rows = (await loadOverviewRows(ws, false)).tickets
  expect(ticketStatus(wf, rows.find((r) => r.id === approve)!)).toMatchObject({ phase: 'human', label: 'Waiting for you', detail: 'Architecture sign-off' })

  const inbox = await loadInbox(ws, admin)
  const group = inbox.groups.find((g) => g.checkpoint === 'Decision')!
  expect(group.items.map((i) => i.id).sort()).toEqual([approve, reject].sort())
  expect(group.items[0]!.decision.options.map((x) => x.outcome)).toEqual(['approve', 'reject'])

  await decide(payload, admin, { ticket: approve, outcome: 'approve', workspaceId: ws })
  await settleDecision(payload, approve)
  await decide(payload, admin, { ticket: reject, outcome: 'reject', workspaceId: ws, note: 'too coupled' })
  expect(await reload(approve)).toMatchObject({ stage: 'review', needsYou: null })
  expect(await reload(reject)).toMatchObject({ stage: 'build' })
  expect((await payload.find({ collection: 'human_touches', where: { kind: { like: 'decide:signoff' } }, pagination: false, ...o })).docs.map((t) => t.kind).sort()).toEqual(['decide:signoff:approve', 'decide:signoff:reject'])
})

it('Path/Steps and Insights carry the custom stages', async () => {
  const { workflowFor } = await import('../src/lib/factory')
  const { loadInsights } = await import('../src/app/(app)/lib/insights')
  const { title } = await import('../src/lib/workflow')
  const wf = workflowFor(ws)
  const data = await loadInsights(payload, wf, ws, { days: 30, product: null })
  expect(data.stages.find((s) => s.stage === 'signoff')).toBeTruthy()
  expect(title(wf, 'signoff')).toBe('Architecture sign-off')
  const { buildSteps } = await import('../src/app/(app)/lib/steps')
  const span = (id: number, stage: string, kind: string, phase: string, m: number, from: string | null) => ({ id, at: new Date(Date.UTC(2026, 10, 1, 10, m)).toISOString(), until: new Date(Date.UTC(2026, 10, 1, 10, m + 1)).toISOString(), seconds: 60, stage, stageKind: kind, phase, fromStage: from, outcome: null, run: null, executor: 'factory', actor: null, cause: 'x' })
  const steps = buildSteps(wf, [span(1, 'build', 'build', 'working', 0, null), span(2, 'security', 'agent', 'working', 1, 'build'), span(3, 'signoff', 'human', 'human', 2, 'security')] as never, [], [], { current: 'signoff', provider: null, admin: true })
  expect(steps.visits.map((v) => [v.stage, v.title])).toEqual([['build', 'build'], ['security', 'Security review'], ['signoff', 'Architecture sign-off']])
})
