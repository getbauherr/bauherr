import type { Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { fastLaneStep, fastLaneText, overlapText } from '../src/lib/hold-text'
import { nextStep } from '../src/lib/next-step'
import { DEFAULT } from '../src/lib/workflow'
import { createTestDb, type TestDb } from './helpers/test-db'

type Doc = Record<string, any>
const o = { overrideAccess: true } as const
let testDb: TestDb
let payload: Payload
let ws: number
let product: number
let n = 0
let holdsOf: typeof import('../src/lib/holds').holdsOf

const ago = (s: number) => new Date(Date.now() - s * 1000).toISOString()
const ticket = async (extra: Doc = {}) => {
  ++n
  return (await payload.create({ collection: 'tickets', data: { number: n, externalId: String(n), title: `t${n}`, state: 'open', product, workspace: ws, ...extra } as any, ...o })) as Doc
}
const link = (t: Doc) => ({ id: t.id, number: t.number, href: `/tickets/${t.id}` })

beforeAll(async () => {
  testDb = await createTestDb('holds_607')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  holdsOf = (await import('../src/lib/holds')).holdsOf
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
})
afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})
beforeEach(async () => {
  await payload.update({ collection: 'workspaces', id: ws, data: { wipLimits: {}, expediteLane: true }, ...o })
  await payload.delete({ collection: 'runs', where: { workspace: { equals: ws } }, ...o })
  await payload.delete({ collection: 'agent_sessions', where: { workspace: { equals: ws } }, ...o })
  await payload.delete({ collection: 'tickets', where: { workspace: { equals: ws } }, ...o })
})

describe('holdsOf', () => {
  it('lists nothing for a Workspace without holds', async () => {
    await ticket({ stage: 'build' })
    expect(await holdsOf(payload, ws)).toEqual([])
  })

  it('names the fast-lane holder for a queued second expedite Ticket, with the shared text', async () => {
    const holder = await ticket({ stage: 'build', expedite: true })
    const second = await ticket({ expedite: true })
    expect(await holdsOf(payload, ws)).toEqual([{ kind: 'fast-lane', text: fastLaneText(holder.number), holder: link(holder), waiting: [link(second)], href: `/tickets/${holder.id}` }])
    expect(fastLaneText(471)).toBe('Waiting for the fast lane: #471 holds it.')
  })

  it('lists no fast-lane hold when the holder yielded its place or the lane is off', async () => {
    const holder = await ticket({ stage: 'build', expedite: true })
    const second = await ticket({ expedite: true })
    await payload.update({ collection: 'tickets', id: holder.id, data: { expediteYieldedTo: second.id }, ...o })
    expect(await holdsOf(payload, ws)).toEqual([])
    await payload.update({ collection: 'tickets', id: holder.id, data: { expediteYieldedTo: null }, ...o })
    await payload.update({ collection: 'workspaces', id: ws, data: { expediteLane: false }, ...o })
    expect(await holdsOf(payload, ws)).toEqual([])
  })

  it('lists a full WIP column with its waiting Tickets, not a blocked one', async () => {
    await payload.update({ collection: 'workspaces', id: ws, data: { wipLimits: { build: 1 } }, ...o })
    await ticket({ stage: 'build' })
    const waiting = await ticket({ stage: 'plan', waitingFor: 'build' })
    const blocker = await ticket({ stage: 'plan' })
    await ticket({ stage: 'plan', waitingFor: 'build', blockedBy: [blocker.id] })
    expect(await holdsOf(payload, ws)).toEqual([{ kind: 'wip', text: 'Build is full (1/1)', stage: 'build', count: 1, limit: 1, waiting: [link(waiting)], href: '/?stage=build' }])
  })

  it('lists an overlap hold naming the Ticket that changes the same files', async () => {
    const holder = await ticket({ stage: 'build' })
    const waiting = await ticket({ stage: 'plan', waitingFor: 'build', waitingReason: `overlaps #${holder.number}` })
    expect(await holdsOf(payload, ws)).toEqual([{ kind: 'overlap', text: overlapText('Build', holder.number), stage: 'build', holder: link(holder), waiting: [link(waiting)], href: `/tickets/${holder.id}` }])
    expect(overlapText('Build', 356)).toBe('Queued for Build: waits for #356, which changes the same files.')
  })

  it('lists a role with waiting Runs and no connected agent, linking the Agent team page with the role', async () => {
    const t = await ticket({ stage: 'build' })
    await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'build', status: 'awaiting_session', role: 'engineer', workspace: ws } as any, ...o })
    const [hold] = await holdsOf(payload, ws)
    expect(hold).toMatchObject({ kind: 'no-agent', role: 'engineer', waiting: [link(t)], href: '/team?role=engineer' })
    expect(hold.text).toBe('No Software engineer agent is connected, 1 Run waits')

    await payload.create({ collection: 'agent_sessions', data: { publicId: 'ses_h1', role: 'engineer', label: 'a', connectedAt: ago(10), lastSeenAt: ago(0), workspace: ws } as any, ...o })
    expect(await holdsOf(payload, ws)).toEqual([])
  })

  it('matches the fast-lane holder by Ticket, not by number, across Products', async () => {
    const other = (await payload.create({ collection: 'products', data: { name: 'api', slug: 'api', workspace: ws }, ...o })).id as number
    const number = 9000
    const holder = await ticket({ number, externalId: 'a', stage: 'build', expedite: true })
    const twin = await ticket({ number, externalId: 'b', product: other, stage: 'plan' })
    const second = await ticket({ expedite: true })
    const holds = await holdsOf(payload, ws)
    expect(holds).toHaveLength(1)
    expect(holds[0]).toMatchObject({ kind: 'fast-lane', holder: link(holder), waiting: [link(second)] })
    expect(holds[0]).not.toMatchObject({ holder: link(twin) })
  })

  it('says the same sentence on the card and in the Ticket bar', async () => {
    const holder = await ticket({ stage: 'build', expedite: true })
    const second = await ticket({ expedite: true })
    const waiting = await ticket({ stage: 'plan', waitingFor: 'build', waitingReason: 'overlaps #4242' })
    const { loadOverviewRows } = await import('../src/app/(app)/lib/overview')
    const rows = (await loadOverviewRows(ws, false)).tickets
    expect(rows.find((t) => t.id === second.id)?.queuedWhy).toBe(`Waiting for the fast lane: #${holder.number} holds it.`)
    expect(rows.find((t) => t.id === waiting.id)?.queuedWhy).toBe('Queued for Build: waits for #4242, which changes the same files.')
    const idle = nextStep({ wf: DEFAULT(), ticket: {}, need: null, run: null, waiting: null, blockers: [], admin: false })
    expect(fastLaneStep(idle, holder.number)).toMatchObject({ label: 'Queued', enabled: false, reason: `Waiting for the fast lane: #${holder.number} holds it.` })
  })
})
