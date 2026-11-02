import { fileURLToPath } from 'node:url'
import pg from 'pg'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

let payload: Payload
let fake: FakeBackend
let jobs: typeof import('../src/jobs')
let actions: typeof import('../src/lib/actions')
let admin: Record<string, any>
const o = { overrideAccess: true, depth: 0 } as const
const repo = 'acme/web'
const PLAN = 'bauherr:approved:plan'
const STAGING = 'bauherr:approved:staging'

beforeAll(async () => {
  const base = process.env.DATABASE_URL ?? 'postgres://bauherr:bauherr@127.0.0.1:54330/bauherr'
  const db = new pg.Client({ connectionString: base })
  await db.connect()
  await db.query('DROP DATABASE IF EXISTS bauherr_test_label_gate_174 WITH (FORCE)')
  await db.query('CREATE DATABASE bauherr_test_label_gate_174')
  await db.end()
  process.env.DATABASE_URL = base.replace(/\/[^/]+$/, '/bauherr_test_label_gate_174')
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  usePack('gated-pack')
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  jobs = await import('../src/jobs')
  actions = await import('../src/lib/actions')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  admin = await payload.create({ collection: 'bauherren', data: { email: 'a@x.io', password: 'pw-123456', role: 'admin', githubLogin: 'owner' }, ...o })
  const workspace = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  const product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace, gateOwners: 'owner' }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace }, ...o })
})

afterAll(async () => {
  fake.actingAs = 'factory'
  await payload?.destroy()
})

const usePack = (name: 'gated-pack' | 'bare-pack') => {
  process.env.BAUHERR_PACK_DIR = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
}
const poll = () => (jobs.pollTickets.handler as (a: unknown) => Promise<unknown>)({ req: { payload } })
const ts = () => fake.tickets(repo)
const row = async (n: string) => (await payload.find({ collection: 'tickets', where: { number: { equals: Number(n) } }, limit: 1, ...o })).docs[0]!
const touches = async (n: string) => (await payload.find({ collection: 'human_touches', where: { ticket: { equals: (await row(n)).id } }, pagination: false, ...o })).docs
const runs = async (n: string, stage: string) => (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: (await row(n)).id } }, { stage: { equals: stage } }] }, ...o })).docs
const rejections = async (n: string) => (await ts().listComments(n)).filter((c) => c.body.includes('bauherr:label-rejected'))
/** A plan-stage Ticket the poller already knows. */
const planTicket = async () => {
  fake.actingAs = 'factory'
  const t = await ts().create({ title: 'x', labels: ['bauherr:stage:plan'] })
  await poll()
  return t.id
}
const labelAs = async (actor: string, n: string, label: string) => {
  fake.actingAs = actor
  await ts().addLabels(n, [label])
  fake.actingAs = 'factory'
}

it('removes and explains a plan label set by a stranger, once, and does not start Build', async () => {
  const n = await planTicket()
  await labelAs('intruder', n, PLAN)
  await poll()
  await poll()
  expect((await ts().get(n)).labels).not.toContain(PLAN)
  expect(await rejections(n)).toHaveLength(1)
  const r = await row(n)
  expect(r.stage).toBe('plan')
  expect(r.labels).not.toContain(PLAN)
  expect(await runs(n, 'build')).toHaveLength(0)
})

it('accepts a gate owner login, starts Build and records the touch with that login', async () => {
  const n = await planTicket()
  await labelAs('owner', n, PLAN)
  await poll()
  expect((await ts().get(n)).labels).toContain(PLAN)
  expect((await row(n)).stage).toBe('build')
  expect(await runs(n, 'build')).toHaveLength(1)
  expect((await touches(n)).map((t) => [t.kind, t.actor])).toEqual([['approve:plan', 'owner']])
})

it('rejects a label by the factory login without a recorded approval', async () => {
  const n = await planTicket()
  await labelAs('factory', n, PLAN)
  await poll()
  expect((await ts().get(n)).labels).not.toContain(PLAN)
  expect((await row(n)).stage).toBe('plan')
})

it('accepts the factory login after approvePlan recorded the touch', async () => {
  const n = await planTicket()
  await actions.approvePlan(payload, admin, { ticket: (await row(n)).id })
  await poll()
  expect((await ts().get(n)).labels).toContain(PLAN)
  expect((await row(n)).stage).toBe('build')
  expect(await rejections(n)).toHaveLength(0)
})

it('accepts inherited sub-ticket approval', async () => {
  const n = await planTicket()
  await actions.submitPlan(payload, admin, { ticket: (await row(n)).id, markdown: '## Goal\n- g\n\n## Sub-tickets\n- **Child one** — Do it.\n' })
  await actions.approvePlan(payload, admin, { ticket: (await row(n)).id })
  await poll()
  const [child] = await ts().listSubTickets(n)
  expect(child!.labels).toContain(PLAN)
  expect((await touches(child!.id)).map((t) => t.kind)).toEqual(['approve:inherited'])
  expect((await row(child!.id)).stage).toBe('build')
})

it('verifies approved:staging the same way', async () => {
  fake.actingAs = 'factory'
  const t = await ts().create({ title: 'y', labels: ['bauherr:stage:release'] })
  await poll()
  await labelAs('intruder', t.id, STAGING)
  await poll()
  expect((await ts().get(t.id)).labels).not.toContain(STAGING)
  expect(await rejections(t.id)).toHaveLength(1)
})

it('leaves the label alone and does not advance while the events are unavailable, then retries', async () => {
  const n = await planTicket()
  await labelAs('owner', n, PLAN)
  const source = ts()
  const real = source.labelEvents.bind(source)
  source.labelEvents = async () => {
    throw new Error('events down')
  }
  await poll()
  expect((await ts().get(n)).labels).toContain(PLAN)
  expect((await row(n)).stage).toBe('plan')
  expect(await rejections(n)).toHaveLength(0)
  source.labelEvents = real
  await poll()
  await poll()
  expect((await row(n)).stage).toBe('build')
})

it('leaves the label pending when the factory login cannot be determined', async () => {
  const n = await planTicket()
  await labelAs('intruder', n, PLAN)
  const source = ts()
  const real = source.whoami.bind(source)
  source.whoami = async () => {
    throw new Error('403')
  }
  await poll()
  expect((await ts().get(n)).labels).toContain(PLAN)
  expect((await row(n)).stage).toBe('plan')
  expect(await rejections(n)).toHaveLength(0)
  source.whoami = real
  await poll()
  expect((await ts().get(n)).labels).not.toContain(PLAN)
  expect(await rejections(n)).toHaveLength(1)
})

it('rejects a factory-login label whose touch is older than the window', async () => {
  const n = await planTicket()
  await actions.approvePlan(payload, admin, { ticket: (await row(n)).id })
  const [touch] = await touches(n)
  await payload.update({ collection: 'human_touches', id: touch!.id, data: { at: new Date(Date.now() - 3_600_000).toISOString() }, ...o })
  await ts().removeLabels(n, [PLAN])
  await ts().addLabels(n, [PLAN])
  await poll()
  expect((await ts().get(n)).labels).not.toContain(PLAN)
})

it('retries a pending label on later polls even when the Ticket is not among the changes, bounded', async () => {
  const n = await planTicket()
  await labelAs('owner', n, PLAN)
  const source = ts()
  const real = source.labelEvents.bind(source)
  source.labelEvents = async () => {
    throw new Error('events down')
  }
  await poll()
  expect((await row(n)).gatePendingAttempts).toBe(1)
  source.labelEvents = real
  await poll()
  expect((await row(n)).stage).toBe('build')
  expect((await row(n)).gatePendingAttempts).toBe(0)
})

it('writes a fresh touch before the label on an acceptStaging retry', async () => {
  fake.actingAs = 'factory'
  const t = await ts().create({ title: 'z', labels: ['bauherr:stage:release'] })
  await poll()
  const r = await row(t.id)
  await payload.update({ collection: 'products', id: r.product, data: { productionGate: true }, ...o })
  await payload.update({ collection: 'tickets', id: r.id, data: { productionState: 'awaiting_approval' }, ...o })
  await actions.acceptStaging(payload, admin, { ticket: r.id })
  for (const touch of await touches(t.id)) await payload.update({ collection: 'human_touches', id: touch.id, data: { at: new Date(Date.now() - 3_600_000).toISOString() }, ...o })
  await ts().removeLabels(t.id, [STAGING])
  await actions.acceptStaging(payload, admin, { ticket: r.id })
  await poll()
  expect((await ts().get(t.id)).labels).toContain(STAGING)
  expect(await rejections(t.id)).toHaveLength(0)
})

it('keeps polling the source when a pending Ticket can no longer be read', async () => {
  const gone = await planTicket()
  const ok = await planTicket()
  await labelAs('owner', gone, PLAN)
  await new Promise((r) => setTimeout(r, 5))
  await labelAs('owner', ok, PLAN)
  const source = ts()
  const real = source.labelEvents.bind(source)
  const get = source.get.bind(source)
  source.labelEvents = async () => {
    throw new Error('events down')
  }
  await poll()
  await poll()
  source.labelEvents = real
  let failed = false
  source.get = async (id: string) => {
    if (id === gone && !failed) {
      failed = true
      throw new Error('404')
    }
    return get(id)
  }
  await poll()
  source.get = get
  expect((await row(ok)).stage).toBe('build')
  expect(failed).toBe(true)
})

it('plan gate off: the plan label is not verified or stripped; plan gate on: it is', async () => {
  usePack('bare-pack')
  const off = await planTicket()
  await labelAs('intruder', off, PLAN)
  await poll()
  expect((await ts().get(off)).labels).toContain(PLAN)
  expect(await rejections(off)).toHaveLength(0)
  usePack('gated-pack')
  const on = await planTicket()
  await labelAs('intruder', on, PLAN)
  await poll()
  expect((await ts().get(on)).labels).not.toContain(PLAN)
  expect(await rejections(on)).toHaveLength(1)
})
