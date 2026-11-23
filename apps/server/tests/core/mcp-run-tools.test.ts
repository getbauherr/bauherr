import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { readEvents, readRecord } from '../../src/core/record/store'
import { ProofRefused, RunNotClaimed } from '../../src/core/run/errors'
import { openMcp, type Mcp } from './mcp-harness'

let m: Mcp
beforeAll(async () => {
  m = await openMcp('core_mcp_run')
}, 120_000)
afterAll(async () => {
  await m?.e.drop()
})

const rows = async (query: ReturnType<typeof sql>) => (await m.e.db.payload.db.drizzle.execute(query)).rows
const status = async (runId: number) =>
  (await rows(sql`SELECT "status" FROM "stage_runs" WHERE "id" = ${runId}`))[0]?.status

const toBrief = async (): Promise<{ record: number; runId: number; leaseToken: string }> => {
  const record = await m.begin()
  const intake = await m.claimed(m.alpha)
  await m.call(
    'submit',
    { runId: intake.runId, leaseToken: intake.leaseToken, result: { verdict: 'accept' } },
    m.agent(m.alpha),
  )
  const brief = await m.claimed(m.alpha)
  return { record, runId: brief.runId, leaseToken: brief.leaseToken }
}

describe('run tools', () => {
  it('does not hand a session the run of a runner Product', async () => {
    await m.e.drain()
    const executor = (value: string) =>
      rows(sql`UPDATE "products" SET "executor" = ${value} WHERE "id" = ${m.e.db.product}`)
    await executor('runner')
    await m.begin()
    const { session } = z
      .object({ session: z.string() })
      .parse(await m.call('connect', { role: 'builder' }, m.agent(m.alpha)))
    expect(await m.call('next_work', { session }, m.agent(m.alpha))).toEqual({ status: 'idle' })
    await executor('session')
    await m.e.drain()
  })

  it('extends the lease and records the step', async () => {
    await m.e.drain()
    await m.begin()
    const run = await m.claimed(m.alpha)
    const out = z
      .object({ leaseExpiresAt: z.string() })
      .parse(
        await m.call('heartbeat', { runId: run.runId, leaseToken: run.leaseToken, step: 'reading' }, m.agent(m.alpha)),
      )
    expect(new Date(out.leaseExpiresAt).getTime()).toBeGreaterThan(m.e.clock.now.getTime())
    expect((await rows(sql`SELECT "steps" FROM "stage_runs" WHERE "id" = ${run.runId}`))[0]?.steps).toMatchObject([
      { text: 'reading' },
    ])
    await m.e.drain()
  })

  it('gives an invalid result exactly one fix turn through the tool', async () => {
    await m.e.drain()
    const record = await m.begin()
    const run = await m.claimed(m.alpha)
    const ids = { runId: run.runId, leaseToken: run.leaseToken }
    const first = z
      .object({ status: z.literal('retry'), problems: z.array(z.object({ path: z.string() })) })
      .parse(await m.call('submit', { ...ids, result: { verdict: 'maybe' } }, m.agent(m.alpha)))
    expect(first.problems[0]?.path).toBe('verdict')
    expect(await status(run.runId)).toBe('claimed')
    expect(await m.call('submit', { ...ids, result: {} }, m.agent(m.alpha))).toMatchObject({ status: 'failed' })
    expect(await status(run.runId)).toBe('failed')
    await expect(m.call('submit', { ...ids, result: { verdict: 'accept' } }, m.agent(m.alpha))).rejects.toThrow(
      RunNotClaimed,
    )
    expect((await m.e.view(record)).types).toContain('run.failed')
    await m.e.drain()
  })

  it('accepts a valid result after the fix turn and moves the ticket on', async () => {
    await m.e.drain()
    const record = await m.begin()
    const run = await m.claimed(m.alpha)
    const ids = { runId: run.runId, leaseToken: run.leaseToken }
    await m.call('submit', { ...ids, result: { verdict: 'maybe' } }, m.agent(m.alpha))
    expect(await m.call('submit', { ...ids, result: { verdict: 'accept' } }, m.agent(m.alpha))).toEqual({
      status: 'accepted',
    })
    expect((await m.e.view(record)).stage).toBe('brief')
    await m.e.drain()
  })

  it('releases a run and queues it again', async () => {
    await m.e.drain()
    const record = await m.begin()
    const run = await m.claimed(m.alpha)
    expect(await m.call('release', { runId: run.runId, leaseToken: run.leaseToken }, m.agent(m.alpha))).toEqual({
      status: 'released',
    })
    expect(await status(run.runId)).toBe('released')
    const live = await rows(
      sql`SELECT "status" FROM "stage_runs" WHERE "record_id" = ${record} AND "status" = 'queued'`,
    )
    expect(live).toHaveLength(1)
    await m.e.drain()
  })
})

describe('attach_proof', () => {
  it('stores a session proof for a criterion of the record and refuses the rest', async () => {
    await m.e.drain()
    const run = await toBrief()
    await m.call(
      'submit',
      { runId: run.runId, leaseToken: run.leaseToken, result: { goal: 'g', open: false } },
      m.agent(m.alpha),
    )
    const build = await m.claimed(m.alpha)
    const ids = { runId: build.runId, leaseToken: build.leaseToken }
    const stored = await readRecord(m.e.db.payload, run.record)
    expect(stored.record.criteria.map((c) => c.id)).toContain('c1')
    const out = z
      .object({ proofId: z.number() })
      .parse(
        await m.call(
          'attach_proof',
          { ...ids, criterion: 'c1', kind: 'output', sha: 'abc', body: 'ok' },
          m.agent(m.alpha),
        ),
      )
    expect(
      await rows(
        sql`SELECT "source", "kind", "criterion", "sha", "body", "url", "record_id" FROM "proofs"
          WHERE "id" = ${out.proofId}`,
      ),
    ).toEqual([
      { source: 'session', kind: 'output', criterion: 'c1', sha: 'abc', body: 'ok', url: null, record_id: run.record },
    ])
    await m.call(
      'attach_proof',
      { ...ids, criterion: 'c2', kind: 'link', sha: 'abc', url: 'https://ci.example/1' },
      m.agent(m.alpha),
    )
    await expect(
      m.call('attach_proof', { ...ids, criterion: 'c9', kind: 'output', sha: 'abc', body: 'x' }, m.agent(m.alpha)),
    ).rejects.toThrow(ProofRefused)
    const bad = [
      { body: 'x'.repeat(20_001) },
      { body: 'x', url: 'https://a.example' },
      {},
      { url: 'not a url' },
      { body: 'x', source: 'ci' },
    ]
    for (const extra of bad) {
      await expect(
        m.call('attach_proof', { ...ids, criterion: 'c1', kind: 'output', sha: 'abc', ...extra }, m.agent(m.alpha)),
      ).rejects.toThrow(z.ZodError)
    }
    const both = { ...ids, criterion: 'c1', kind: 'output', sha: 'abc', body: 'x', url: 'https://a.example' }
    await expect(m.call('attach_proof', both, m.agent(m.alpha))).rejects.toThrow(/give exactly one of body, url/)
    expect(await rows(sql`SELECT 1 FROM "proofs" WHERE "record_id" = ${run.record}`)).toHaveLength(2)
    await m.e.drain()
  })
})

describe('ask', () => {
  it('opens an agent question, releases the run, and hands the answer to the next run', async () => {
    await m.e.drain()
    const record = await m.begin()
    const run = await m.claimed(m.alpha)
    const ids = { runId: run.runId, leaseToken: run.leaseToken }
    await expect(
      m.call('ask', { ...ids, question: 'x'.repeat(201), options: ['a', 'b'] }, m.agent(m.alpha)),
    ).rejects.toThrow(z.ZodError)
    await expect(m.call('ask', { ...ids, question: 'q?', options: ['a'] }, m.agent(m.alpha))).rejects.toThrow(
      z.ZodError,
    )
    expect(await m.call('ask', { ...ids, question: 'Which API?', options: ['v1', 'v2'] }, m.agent(m.alpha))).toEqual({
      status: 'asked',
    })
    expect(await status(run.runId)).toBe('released')
    const shown = await m.e.view(record)
    expect(shown).toMatchObject({
      waitingOn: 'owner',
      card: { card: 'question', reason: 'agent', options: ['v1', 'v2'], text: 'Which API?' },
    })
    expect(
      await rows(sql`SELECT 1 FROM "stage_runs" WHERE "record_id" = ${record} AND "status" IN ('queued', 'claimed')`),
    ).toEqual([])
    const seq = await m.e.seq(record)
    const owner = m.person(m.alpha, [m.e.db.workspace])
    await expect(m.call('decide', { record, ask: 'question:agent', choice: 'v3', seq }, owner)).rejects.toThrow(
      /not an option/,
    )
    await expect(
      m.call('decide', { record, ask: 'question:agent', choice: 'v2', seq: seq + 1 }, owner),
    ).rejects.toThrow(/not asking/)
    expect(await m.call('decide', { record, ask: 'question:agent', choice: 'v2', seq }, owner)).toEqual({
      status: 'decided',
    })
    const types = (await readEvents(m.e.db.payload, record)).map((e) => e.type)
    expect(types.slice(-3)).toEqual(['question.answered', 'owner.note', 'run.started'])
    expect((await m.e.view(record)).waitingOn).toBe('agents')
    const again = await m.claimed(m.alpha)
    expect(again.runId).not.toBe(run.runId)
    expect(again.context.note).toBe('Question: Which API?\nAnswer: v2')
    await m.e.drain()
  })
})

describe('ask options', () => {
  it.each([
    ['back to Brief', ['Send back to Brief: full redesign from a mockup', 'Keep the gaps Brief']],
    ['discard', ['Discard this ticket', 'Keep going']],
    ['close', ['Close the ticket as done', 'Keep going']],
    ['park', ['Park the ticket for later', 'Keep going']],
    ['close this ticket', ['Close this ticket as done', 'Keep going']],
    ['park the ticket', ['Parking the ticket until #555 lands', 'Keep going']],
    ['park with a label', ['Parked: wait for the owner', 'Keep going']],
    ['send it back', ['Send it back to Build', 'Keep going']],
  ])('refuses an option that promises to %s and keeps the run claimed', async (_name, options) => {
    await m.e.drain()
    const record = await m.begin()
    const run = await m.claimed(m.alpha)
    const ids = { runId: run.runId, leaseToken: run.leaseToken }
    await expect(m.call('ask', { ...ids, question: 'How?', options }, m.agent(m.alpha))).rejects.toThrow(
      new RegExp(`Option "${options[0]}".*Back to Brief is already on the card`),
    )
    expect(await status(run.runId)).toBe('claimed')
    expect((await m.e.view(record)).waitingOn).toBe('agents')
    await m.e.drain()
  })

  it('accepts normal options', async () => {
    await m.e.drain()
    const record = await m.begin()
    const run = await m.claimed(m.alpha)
    const options = ['Close this modal on save', 'Parking is out of scope', 'Send back 404 for an unknown session']
    options.push('Discard it and recompute from source')
    const ids = { runId: run.runId, leaseToken: run.leaseToken }
    expect(await m.call('ask', { ...ids, question: 'Which?', options }, m.agent(m.alpha))).toEqual({ status: 'asked' })
    expect(await m.e.view(record)).toMatchObject({ card: { card: 'question', options } })
    await m.e.drain()
  })
})

describe('session capacity', () => {
  const connectWith = async (extra: Record<string, unknown> = {}) =>
    z
      .object({ session: z.string(), capacity: z.number() })
      .parse(await m.call('connect', { role: 'builder', ...extra }, m.agent(m.alpha)))
  const nextWork = (session: string) => m.call('next_work', { session }, m.agent(m.alpha))
  const work = z.object({ status: z.literal('work'), runId: z.number(), leaseToken: z.string() })
  const atCapacity = z.object({ status: z.literal('at_capacity'), holding: z.array(z.number()) })

  it('gives a session of capacity 3 three runs, then answers at capacity until a slot frees', async () => {
    await m.e.drain()
    for (let i = 0; i < 4; i++) await m.begin()
    const { session, capacity } = await connectWith({ capacity: 3 })
    expect(capacity).toBe(3)
    const runs = []
    for (let i = 0; i < 3; i++) runs.push(work.parse(await nextWork(session)))
    expect(new Set(runs.map((r) => r.leaseToken)).size).toBe(3)
    expect(new Set(runs.map((r) => r.runId)).size).toBe(3)
    const full = atCapacity.parse(await nextWork(session))
    expect(full.holding).toEqual(runs.map((r) => r.runId).sort((a, b) => a - b))
    const first = runs[0]
    await m.call('release', { runId: first?.runId, leaseToken: first?.leaseToken }, m.agent(m.alpha))
    expect(work.parse(await nextWork(session)).status).toBe('work')
    expect(atCapacity.parse(await nextWork(session)).holding).toHaveLength(3)
    const second = runs[1]
    const submitted = { runId: second?.runId, leaseToken: second?.leaseToken, result: { verdict: 'accept' } }
    expect(await m.call('submit', submitted, m.agent(m.alpha))).toEqual({ status: 'accepted' })
    expect(work.parse(await nextWork(session)).status).toBe('work')
    expect(atCapacity.parse(await nextWork(session)).holding).toHaveLength(3)
    await m.e.drain()
  })

  it('lets a session without capacity hold one run and names it', async () => {
    await m.e.drain()
    await m.begin()
    await m.begin()
    const { session, capacity } = await connectWith()
    expect(capacity).toBe(1)
    const held = work.parse(await nextWork(session))
    expect(atCapacity.parse(await nextWork(session)).holding).toEqual([held.runId])
    await m.e.drain()
  })

  it('gives two instances of one key a slot each', async () => {
    await m.e.drain()
    await m.begin()
    await m.begin()
    const a = await connectWith({ instance: 'proc-a' })
    const b = await connectWith({ instance: 'proc-b' })
    expect(a.session).not.toBe(b.session)
    expect(work.parse(await nextWork(a.session)).status).toBe('work')
    expect(work.parse(await nextWork(b.session)).status).toBe('work')
    await m.e.drain()
  })

  it('clamps capacity to 1..4 and updates it on reconnect', async () => {
    await m.e.drain()
    for (let i = 0; i < 3; i++) await m.begin()
    expect((await connectWith({ capacity: 9 })).capacity).toBe(4)
    expect((await connectWith({ capacity: 0 })).capacity).toBe(1)
    const { session, capacity } = await connectWith({ capacity: 2 })
    expect(capacity).toBe(2)
    work.parse(await nextWork(session))
    work.parse(await nextWork(session))
    expect(atCapacity.parse(await nextWork(session)).holding).toHaveLength(2)
    await m.e.drain()
  })
})
