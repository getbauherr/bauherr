import { FakeBackend } from '@bauherr/adapters'
import { createHmac } from 'node:crypto'
import { sql } from '@payloadcms/db-postgres'
import { z } from 'zod'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mirrorItemTask } from '../../src/core/jobs'
import { appendEvent, createRecord, readEvents } from '../../src/core/record/store'
import { intakeHarness } from './intake-harness'
import { readerOf, START } from './mirror-harness'

const { h, reacting } = intakeHarness('core_hooks')

const SECRET = 'test-hook-secret'
const o = { overrideAccess: true } as const
type Route = typeof import('../../src/app/api/hooks/[connection]/route')
let route: Route

const sign = (body: string, secret = SECRET) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

type Delivery = { body?: string; event?: string; signature?: string | null; connection?: number }

const deliver = async (delivery: Delivery = {}): Promise<number> => {
  const body = delivery.body ?? '{}'
  const headers: Record<string, string> = {
    'x-github-event': delivery.event ?? 'ping',
    'content-type': 'application/json',
  }
  const signature = delivery.signature === undefined ? sign(body) : delivery.signature
  if (signature !== null) headers['x-hub-signature-256'] = signature
  const request = new Request('http://t/api/hooks/1', { method: 'POST', headers, body })
  const params = Promise.resolve({ connection: String(delivery.connection ?? h.ids.connection) })
  return (await route.POST(request, { params })).status
}

const comment = (repo: string, number: number) =>
  JSON.stringify({ repository: { full_name: repo }, issue: { number } })

const queued = async () => {
  const result = await h.rows(sql`
    SELECT "input" FROM "payload_jobs" WHERE "task_slug" = 'mirror-item' AND "completed_at" IS NULL`)
  return result.map((row) => z.object({ source: z.number(), kind: z.string(), number: z.number() }).parse(row.input))
}

const deliveredAt = async () =>
  (await h.rows(sql`SELECT "webhook_delivered_at" AS at FROM "connections" WHERE "id" = ${h.ids.connection}`))[0]?.at

const setSecret = (webhookSecret: string | null) =>
  h.payload().update({ collection: 'connections', id: h.ids.connection, data: { webhookSecret }, ...o })

beforeAll(async () => {
  route = await import('../../src/app/api/hooks/[connection]/route')
})

beforeEach(async () => {
  await setSecret(SECRET)
  await h.rows(sql`UPDATE "connections" SET "webhook_delivered_at" = NULL`)
  await h.rows(sql`DELETE FROM "payload_jobs" WHERE "task_slug" = 'mirror-item'`)
})

describe('the receiver', () => {
  it('answers 401 to a wrong signature and to none', async () => {
    expect(await deliver({ signature: sign('{}', 'another-secret') })).toBe(401)
    expect(await deliver({ signature: null })).toBe(401)
    expect(await deliver({ connection: 99999 })).toBe(401)
    expect(await deliveredAt()).toBeNull()
  })

  it('answers 401 when the connection has no webhook secret', async () => {
    await setSecret(null)
    expect(await deliver({ signature: sign('{}', '') })).toBe(401)
    expect(await deliver({ signature: sign('{}', 'undefined') })).toBe(401)
  })

  it('answers 413 to a body over 5 MB, signed or not', async () => {
    const body = 'x'.repeat(5 * 1024 * 1024 + 1)
    expect(await deliver({ body })).toBe(413)
  })

  it('stores the secret encrypted and never returns it', async () => {
    const email = `hooks-${Date.now()}@example.com`
    const data = { email, password: 'pw-123456-hooks', role: 'admin' } as const
    const admin = await h.payload().create({ collection: 'bauherren', data, ...o })
    const id = h.ids.connection
    const asAdmin = await h.payload().findByID({
      collection: 'connections',
      id,
      user: admin,
      overrideAccess: false,
      showHiddenFields: true,
    })
    expect(JSON.stringify(asAdmin)).not.toContain(SECRET)
    expect(asAdmin).not.toHaveProperty('webhookSecret')
    const raw = (await h.rows(sql`SELECT "webhook_secret" FROM "connections" WHERE "id" = ${h.ids.connection}`))[0]
    expect(String(raw?.webhook_secret)).toMatch(/^enc:v1:/)
    const stored = await h.payload().findByID({ collection: 'connections', id, showHiddenFields: true, ...o })
    const hidden = JSON.stringify(stored)
    expect(hidden).not.toContain(SECRET)
  })

  it('answers 202 to a verified delivery of an untracked repository: no job, delivery recorded', async () => {
    expect(await deliver({ event: 'issues', body: comment('nobody/else', 3) })).toBe(202)
    expect(await queued()).toEqual([])
    expect(await deliveredAt()).not.toBeNull()
  })

  it('queues one job for a verified delivery of a tracked repository', async () => {
    const repo = h.fresh()
    const source = await h.newSource(repo)
    expect(await deliver({ event: 'issue_comment', body: comment(repo, 3) })).toBe(202)
    expect(await queued()).toEqual([{ source, kind: 'issue', number: 3 }])
  })

  it('queues one job for two deliveries of the same item, and one each for two items', async () => {
    const repo = h.fresh()
    await h.newSource(repo)
    expect(await deliver({ event: 'issues', body: comment(repo, 3) })).toBe(202)
    expect(await deliver({ event: 'issue_comment', body: comment(repo, 3) })).toBe(202)
    expect(await queued()).toHaveLength(1)
    expect(await deliver({ event: 'issues', body: comment(repo, 4) })).toBe(202)
    expect((await queued()).map((job) => job.number).sort()).toEqual([3, 4])
  })

  it('queues the open mirrored pull requests that have the head commit of a status', async () => {
    const repo = h.fresh()
    const fake = new FakeBackend({ native: true, user: 'jo' })
    await fake.forge.createBranch(repo, 'fix')
    const sha = fake.commit(repo, 'fix', 'a.txt', 'x')
    const pull = await fake.forge.openPullRequest(repo, { title: 'p', head: 'fix', base: 'main' })
    await h.settle({ [repo]: readerOf(fake) })
    const body = JSON.stringify({ repository: { full_name: repo }, sha })
    expect(await deliver({ event: 'status', body })).toBe(202)
    expect((await queued()).map((job) => [job.kind, job.number])).toEqual([['pr', pull.number]])
    const other = JSON.stringify({ repository: { full_name: repo }, sha: 'unknown' })
    await h.rows(sql`DELETE FROM "payload_jobs" WHERE "task_slug" = 'mirror-item'`)
    expect(await deliver({ event: 'status', body: other })).toBe(202)
    expect(await queued()).toEqual([])
  })
})

describe('a delivery on the fake forge', () => {
  it('brings the reporter reply into the mirror and the ticket reacts, without a sync run', async () => {
    const repo = h.fresh()
    const fake = new FakeBackend({ native: true, user: 'jo', users: ['jo'] })
    const issue = await fake.tickets(repo).create({ title: 'broken' })
    const readers = { [repo]: readerOf(fake) }
    await h.settle(readers)
    const record = await createRecord(h.payload(), {
      workspace: h.ids.workspace,
      product: h.ids.product,
      source: { forge: 'github', repo, number: issue.number, reporter: 'jo', external: false, backlog: false },
      type: 'bug',
    })
    const asked = await appendEvent(h.payload(), record.id, {
      type: 'intake.asked',
      data: { round: 1 },
      actor: 'factory',
    })
    await h.rows(sql`UPDATE "events" SET "created_at" = '2025-12-01T00:00:00Z' WHERE "id" = ${asked.id}`)
    fake.actingAs = 'jo'
    await fake.tickets(repo).comment(String(issue.number), 'the answer is yes')

    expect(await deliver({ event: 'issue_comment', body: comment(repo, issue.number) })).toBe(202)
    const [job] = await queued()
    const reader = async () => readerOf(fake)
    const task = mirrorItemTask(() => reacting, () => ({ reader, now: () => START }))
    await (task.handler as (a: unknown) => Promise<unknown>)({ input: job, req: { payload: h.payload() } })

    const types = (await readEvents(h.payload(), record.id)).map((e) => e.type)
    expect(types.filter((t) => t === 'reporter.replied')).toHaveLength(1)
  })
})
