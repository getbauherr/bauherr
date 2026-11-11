import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { bottleneckSentence } from '../src/app/(app)/lib/insights'
import { DEFAULT, kindOf } from '../src/lib/workflow'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let ws: number
let product: number
let insights: typeof import('../src/app/(app)/lib/insights')
let testDb: TestDb
const o = { overrideAccess: true } as const
const H = 3600e3
const now = Date.UTC(2026, 10, 10)

beforeAll(async () => {
  testDb = await createTestDb('insights')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  insights = await import('../src/app/(app)/lib/insights')
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

/** One Ticket that waited `queued` hours for a Build slot: 1 h triage queue, 1 h plan, queued, 2 h build, 1 h review, done. */
const ticket = async (n: number, startDaysAgo: number, queued: number) => {
  const t = (await payload.create({ collection: 'tickets', data: { title: `t${n}`, externalId: `x${n}`, number: n, state: 'closed', stage: 'done', product, workspace: ws }, ...o })).id as number
  const start = now - startDaysAgo * 864e5
  let at = start
  const wf = DEFAULT()
  for (const [stage, phase, hours] of [['triage', 'queued', 1], ['plan', 'working', 1], ['build', 'queued', queued], ['build', 'working', 2], ['review', 'working', 1], ['done', 'closed', 0]] as const) {
    await payload.create({ collection: 'ticket_events', data: { ticket: t, workspace: ws, at: new Date(at).toISOString(), stage, stageKind: kindOf(wf, stage), phase, cause: 'test' }, ...o })
    at += hours * H
  }
}

it('turns seeded events into tiles, a bottleneck and throughput', async () => {
  await ticket(1, 3, 10)
  await ticket(2, 4, 20)
  await ticket(3, 5, 30)
  await ticket(4, 20, 40)
  const r = await insights.loadInsights(payload, DEFAULT(), ws, { days: 7, product: null, now })
  expect(r.done).toBe(3)
  expect(r.leadMedianSec).toBe(25 * 3600)
  expect(r.leadP85Sec).toBe(32 * 3600)
  expect(r.cycleMedianSec).toBe(24 * 3600)
  expect(r.share.queued).toBeCloseTo(63 / 75)
  expect(r.share.working).toBeCloseTo(12 / 75)
  expect(r.bottleneck).toMatchObject({ stage: 'build', phase: 'queued', sentence: 'Tickets wait 20 h for a Build slot' })
  expect(r.stages.map((s) => s.stage)).toEqual(['triage', 'plan', 'build', 'review'])
  expect(r.throughput.reduce((a, w) => a + w.tickets, 0)).toBe(3)
  const wide = await insights.loadInsights(payload, DEFAULT(), ws, { days: 30, product: null, now })
  expect(wide.done).toBe(4)
  expect(wide.leadMedianSec).toBe(30 * 3600)
})

it('narrows by Product and says nothing without history', async () => {
  const other = (await payload.create({ collection: 'products', data: { name: 'other', slug: 'other', workspace: ws }, ...o })).id as number
  const r = await insights.loadInsights(payload, DEFAULT(), ws, { days: 30, product: other, now })
  expect(r).toMatchObject({ done: 0, leadMedianSec: null, bottleneck: null, stages: [], throughput: [] })
})

it('names the biggest share of the slowest stage in words', () => {
  expect(bottleneckSentence('Plan', 'human', 14 * 3600)).toBe('Tickets wait 14 h for you in Plan')
  expect(bottleneckSentence('Build', 'queued', 2.1 * 86400)).toBe('Tickets wait 2.1 d for a Build slot')
  expect(bottleneckSentence('Review', 'ci', 600)).toBe('Tickets wait 10 min on CI in Review')
  expect(bottleneckSentence('Build', 'working', 3600)).toBe('Build takes 1 h of work per Ticket')
})

it('lists the open Tickets that waited longest, oldest first', async () => {
  const mk = async (n: number, hoursAgo: number) => {
    const t = (await payload.create({ collection: 'tickets', data: { title: `open${n}`, externalId: `o${n}`, number: 100 + n, state: 'open', stage: 'build', product, workspace: ws }, ...o })).id as number
    await payload.create({ collection: 'ticket_events', data: { ticket: t, workspace: ws, at: new Date(now - hoursAgo * H).toISOString(), stage: 'build', stageKind: 'build', phase: 'queued', cause: 'test' }, ...o })
  }
  await mk(1, 5)
  await mk(2, 50)
  const wip = await insights.wipAge(payload, DEFAULT(), ws, null, now)
  expect(wip.map((w) => w.number)).toEqual([102, 101])
  expect(wip[0]!.seconds).toBe(50 * 3600)
})
