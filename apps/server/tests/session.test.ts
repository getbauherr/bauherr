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

it('session Runs without a heartbeat for 30 minutes go needs_human', async () => {
  const { expireStaleSessions, SESSION_TIMEOUT_MS } = await import('../src/jobs')
  const ticket = await seedTicket('e', 'session')
  const { run } = await (await import('../src/jobs')).startRunIfNeeded(payload, ticket, 'build')
  expect(await expireStaleSessions(payload)).toBe(0)
  expect(await expireStaleSessions(payload, Date.now() + SESSION_TIMEOUT_MS + 60_000)).toBeGreaterThanOrEqual(1)
  expect((await payload.findByID({ collection: 'runs', id: run.id, ...o })).status).toBe('needs_human')
})
