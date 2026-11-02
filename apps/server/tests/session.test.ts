import pg from 'pg'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

let payload: Payload
const o = { overrideAccess: true } as const

beforeAll(async () => {
  const base = process.env.DATABASE_URL ?? 'postgres://bauherr:bauherr@127.0.0.1:54330/bauherr'
  const admin = new pg.Client({ connectionString: base })
  await admin.connect()
  await admin.query('DROP DATABASE IF EXISTS bauherr_test_session WITH (FORCE)')
  await admin.query('CREATE DATABASE bauherr_test_session')
  await admin.end()
  process.env.DATABASE_URL = base.replace(/\/[^/]+$/, '/bauherr_test_session')
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  // Schema comes from push; the partial unique index lives only in the migration.
  await (await import('../src/migrations/20261030_140000_active_run_unique')).up({ db: payload.db.drizzle } as never)
})

afterAll(async () => {
  await payload?.destroy()
})

const seedTicket = async (slug: string, defaultMode?: 'session' | 'autonomous') => {
  const workspace = (await payload.create({ collection: 'workspaces', data: { name: slug, slug, defaultMode }, ...o })).id
  const product = (await payload.create({ collection: 'products', data: { name: slug, slug, workspace }, ...o })).id
  return payload.create({ collection: 'tickets', data: { title: slug, externalId: slug, product, workspace, number: 1 }, ...o })
}

it('a session-stage Ticket yields an awaiting_session Run and no queued job', async () => {
  const { startRunIfNeeded } = await import('../src/jobs')
  const ticket = await seedTicket('s', 'session')
  const { run } = await startRunIfNeeded(payload, ticket, 'plan')
  expect(run).toMatchObject({ mode: 'session', status: 'awaiting_session' })
  expect((await payload.count({ collection: 'payload-jobs' as never, where: { taskSlug: { equals: 'run-stage' } } as never, ...o })).totalDocs).toBe(0)

  const { run: auto } = await startRunIfNeeded(payload, await seedTicket('a'), 'plan')
  expect(auto).toMatchObject({ mode: 'autonomous', status: 'queued' })
  expect((await payload.count({ collection: 'payload-jobs' as never, where: { taskSlug: { equals: 'run-stage' } } as never, ...o })).totalDocs).toBe(1)
})

it('concurrent starts for the same ticket and stage yield one Run', async () => {
  const { startRunIfNeeded } = await import('../src/jobs')
  const ticket = await seedTicket('c')
  const results = await Promise.all([startRunIfNeeded(payload, ticket, 'plan'), startRunIfNeeded(payload, ticket, 'plan')])
  expect(results[0].run.id).toBe(results[1].run.id)
  expect(results.filter((r) => r.created)).toHaveLength(1)
  expect((await payload.count({ collection: 'runs', where: { ticket: { equals: ticket.id } }, ...o })).totalDocs).toBe(1)
})

it('an unclaimed session Run never expires; a claimed one without a heartbeat is abandoned with a successor', async () => {
  const { expireStaleSessions, startRunIfNeeded, SESSION_TIMEOUT_MS } = await import('../src/jobs')
  const ticket = await seedTicket('e', 'session')
  const { run } = await startRunIfNeeded(payload, ticket, 'build')
  const later = Date.now() + 2 * 3600_000 + 60_000
  expect(await expireStaleSessions(payload, later)).toBe(0)
  expect((await payload.findByID({ collection: 'runs', id: run.id, ...o })).status).toBe('awaiting_session')
  await payload.update({ collection: 'runs', id: run.id, data: { status: 'running', heartbeatAt: new Date().toISOString() }, ...o })
  expect(await expireStaleSessions(payload, Date.now() + SESSION_TIMEOUT_MS + 60_000)).toBeGreaterThanOrEqual(1)
  expect((await payload.findByID({ collection: 'runs', id: run.id, ...o })).status).toBe('abandoned')
  expect((await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: ticket.id } }, { status: { equals: 'awaiting_session' } }] }, ...o })).totalDocs).toBe(1)
})

it('the requeue migration gives a successor to Runs that expired unclaimed', async () => {
  const { up } = await import('../src/migrations/20261102_150170_requeue_expired_unclaimed_runs')
  const ticket = await seedTicket('m', 'session')
  const { run } = await (await import('../src/jobs')).startRunIfNeeded(payload, ticket, 'build')
  await payload.update({ collection: 'runs', id: run.id, data: { status: 'needs_human', error: 'session heartbeat timeout' }, ...o })
  await up({ db: payload.db.drizzle } as never)
  expect((await payload.findByID({ collection: 'runs', id: run.id, ...o })).status).toBe('abandoned')
  const next = await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: ticket.id } }, { status: { equals: 'awaiting_session' } }] }, depth: 0, ...o })
  expect(next.docs).toHaveLength(1)
  expect(next.docs[0].previousRun).toBe(run.id)
  await up({ db: payload.db.drizzle } as never)
  expect((await payload.count({ collection: 'runs', where: { ticket: { equals: ticket.id } }, ...o })).totalDocs).toBe(2)
})

it('two parallel expiry passes abandon an unclaimed Triage Run and untriage its Ticket once', async () => {
  const { expireStaleSessions, startRunIfNeeded } = await import('../src/jobs')
  const ticket = await seedTicket('p', 'session')
  await payload.update({ collection: 'tickets', id: ticket.id, data: { triagedAt: new Date().toISOString() }, ...o })
  const { run } = await startRunIfNeeded(payload, ticket, 'triage')
  const later = Date.now() + 3 * 3600_000
  const handled = await Promise.all([expireStaleSessions(payload, later), expireStaleSessions(payload, later)])
  expect(handled[0] + handled[1]).toBe(1)
  expect((await payload.findByID({ collection: 'runs', id: run.id, ...o })).status).toBe('abandoned')
  expect((await payload.findByID({ collection: 'tickets', id: ticket.id, ...o })).triagedAt).toBeNull()
})
