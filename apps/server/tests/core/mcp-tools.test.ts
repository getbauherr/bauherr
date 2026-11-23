import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  ModuleMissing,
  RunNotFound,
  SessionNotFound,
  UnknownTool,
  WrongKeyKind,
  WrongLeaseToken,
} from '../../src/core/run/errors'
import { TOOLS } from '../../src/core/run/mcp/registry'
import { openMcp, type Mcp } from './mcp-harness'

let m: Mcp
beforeAll(async () => {
  m = await openMcp('core_mcp_tools')
}, 120_000)
afterAll(async () => {
  await m?.e.drop()
})

const rows = async (query: ReturnType<typeof sql>) => (await m.e.db.payload.db.drizzle.execute(query)).rows
const status = async (runId: number) =>
  (await rows(sql`SELECT "status" FROM "stage_runs" WHERE "id" = ${runId}`))[0]?.status

describe('the tool set', () => {
  it('has nine tools with short descriptions and refuses unknown fields', async () => {
    expect(TOOLS.map((t) => t.name)).toEqual([
      'connect',
      'next_work',
      'heartbeat',
      'search',
      'attach_proof',
      'ask',
      'submit',
      'release',
      'decide',
    ])
    for (const tool of TOOLS) expect(tool.description.split('. ').length, tool.name).toBeLessThanOrEqual(2)
    await expect(m.call('connect', { role: 'builder', extra: 1 }, m.agent(m.alpha))).rejects.toThrow(z.ZodError)
    await expect(m.call('nope', {}, m.agent(m.alpha))).rejects.toThrow(UnknownTool)
  })

  it('tells agents before the call to pass a stable random instance id once per process', () => {
    const tool = TOOLS.find((t) => t.name === 'connect')
    const schema = z.object({ properties: z.record(z.string(), z.object({ description: z.string().optional() })) })
    const fields = schema.parse(z.toJSONSchema(tool?.input ?? z.object({}), { io: 'input' })).properties
    expect(tool?.description).toContain('once per process with a stable random instance id')
    expect(fields.instance?.description).toContain('generate it once per process')
    expect(fields.instance?.description).toContain('same value on every reconnect')
  })

  it('tells agents before the call that attach_proof takes body or url, not both', () => {
    const tool = TOOLS.find((t) => t.name === 'attach_proof')
    const schema = z.object({ properties: z.record(z.string(), z.object({ description: z.string().optional() })) })
    const fields = schema.parse(z.toJSONSchema(tool?.input ?? z.object({}), { io: 'input' })).properties
    for (const text of [tool?.description, fields.body?.description, fields.url?.description]) {
      expect(text).toContain('not both')
      expect(text).toContain('a link with an explanation goes into body')
    }
  })
})

describe('keys', () => {
  it('lets an agent key never decide and a personal key never use an agent tool', async () => {
    const record = await m.begin()
    const decision = { record, ask: 'brief', choice: 'approve', seq: 0 }
    await expect(m.call('decide', decision, m.agent(m.alpha))).rejects.toThrow(WrongKeyKind)
    await expect(m.call('connect', { role: 'builder' }, m.person(m.alpha, [m.e.db.workspace]))).rejects.toThrow(
      WrongKeyKind,
    )
    await expect(m.call('next_work', { session: 'x' }, m.person(m.alpha, [m.e.db.workspace]))).rejects.toThrow(
      WrongKeyKind,
    )
    expect((await m.e.view(record)).types).not.toContain('brief.approved')
  })

  it('lets decide refuse a person of another Workspace', async () => {
    const record = await m.begin()
    const outsider = m.person(m.beta, [m.e.db.otherWorkspace])
    await expect(m.call('decide', { record, ask: 'brief', choice: 'approve', seq: 0 }, outsider)).rejects.toThrow(
      /may not decide/,
    )
  })
})

describe('sessions and next_work', () => {
  it('refreshes the same session per key and role and says when there is no work', async () => {
    const a = z.object({ session: z.string() }).parse(await m.call('connect', { role: 'verifier' }, m.agent(m.alpha)))
    const b = z.object({ session: z.string() }).parse(await m.call('connect', { role: 'verifier' }, m.agent(m.alpha)))
    expect(b.session).toBe(a.session)
    expect(await m.call('next_work', { session: a.session }, m.agent(m.alpha))).toEqual({ status: 'idle' })
  })

  it('gives each instance id its own session and refreshes label and capacity on the same one', async () => {
    const connect = async (extra: Record<string, unknown>) =>
      z
        .object({ session: z.string(), capacity: z.number() })
        .parse(await m.call('connect', { role: 'reviewer', ...extra }, m.agent(m.alpha)))
    const a = await connect({ instance: 'proc-a', capacity: 1, label: 'one' })
    const b = await connect({ instance: 'proc-b' })
    expect(b.session).not.toBe(a.session)
    const again = await connect({ instance: 'proc-a', capacity: 3, label: 'two' })
    expect(again).toEqual({ session: a.session, capacity: 3 })
    const found = await rows(
      sql`SELECT "label", "capacity", "client_key" FROM "agent_sessions" WHERE "public_id" = ${a.session}`,
    )
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ label: 'two', capacity: '3' })
    expect(found[0]?.client_key).toMatch(/^key-\d+:reviewer:proc-a$/)
    const plain = await connect({})
    expect((await connect({})).session).toBe(plain.session)
    const key = await rows(sql`SELECT "client_key" FROM "agent_sessions" WHERE "public_id" = ${plain.session}`)
    expect(key[0]?.client_key).toMatch(/^key-\d+:reviewer$/)
  })

  it('refuses an unknown session and the session of another key', async () => {
    const { session } = z
      .object({ session: z.string() })
      .parse(await m.call('connect', { role: 'builder' }, m.agent(m.alpha)))
    await expect(m.call('next_work', { session }, m.agent(m.beta))).rejects.toThrow(SessionNotFound)
    await expect(m.call('next_work', { session: 'missing' }, m.agent(m.alpha))).rejects.toThrow(SessionNotFound)
  })

  it('claims for the role of the session with the context pack and the schema', async () => {
    const record = await m.begin()
    const { session } = z
      .object({ session: z.string() })
      .parse(await m.call('connect', { role: 'builder' }, m.agent(m.alpha)))
    const out = z
      .object({
        status: z.literal('work'),
        runId: z.number(),
        leaseToken: z.string(),
        context: z.object({
          stage: z.string(),
          role: z.string(),
          note: z.null(),
          resultSchema: z.object({ type: z.literal('object') }),
          record: z.object({ goal: z.string() }),
          runId: z.number(),
        }),
      })
      .parse(await m.call('next_work', { session }, m.agent(m.alpha)))
    expect(out.context).toMatchObject({ stage: 'intake', role: 'builder', runId: out.runId })
    expect(await rows(sql`SELECT "leased_by" FROM "stage_runs" WHERE "id" = ${out.runId}`)).toEqual([
      { leased_by: session },
    ])
    await m.call('release', { runId: out.runId, leaseToken: out.leaseToken }, m.agent(m.alpha))
    await m.e.drain()
    expect(record).toBeGreaterThan(0)
  })

  it('answers with a clear error for a stage without a module and keeps the run queued', async () => {
    await m.e.drain()
    const record = await m.begin()
    const { session } = z
      .object({ session: z.string() })
      .parse(await m.call('connect', { role: 'builder' }, m.agent(m.alpha)))
    const { agent } = m.agent(m.alpha)
    const bare = { agent: { ...agent, deps: { ...agent.deps, modules: {} } } }
    await expect(m.call('next_work', { session }, bare)).rejects.toThrow(ModuleMissing)
    const live = await rows(
      sql`SELECT "status" FROM "stage_runs" WHERE "record_id" = ${record} AND "status" IN ('queued', 'claimed')`,
    )
    expect(live).toHaveLength(1)
    const run = await m.claimed(m.alpha)
    const ids = { runId: run.runId, leaseToken: run.leaseToken, result: {} }
    await expect(m.call('submit', ids, bare)).rejects.toThrow(ModuleMissing)
    await m.e.drain()
  })
})

describe('workspace and lease isolation', () => {
  it('treats a run of another Workspace as not found and leaves it untouched', async () => {
    await m.e.drain()
    await m.begin()
    const mine = await m.claimed(m.alpha)
    const theirs = m.agent(m.beta)
    const lease = { runId: mine.runId, leaseToken: mine.leaseToken }
    for (const [name, raw] of [
      ['heartbeat', lease],
      ['search', { ...lease, query: 'x' }],
      ['attach_proof', { ...lease, criterion: 'c1', kind: 'output', sha: 's', body: 'b' }],
      ['ask', { ...lease, question: 'q?', options: ['a', 'b'] }],
      ['submit', { ...lease, result: { verdict: 'accept' } }],
      ['release', lease],
    ] as const) {
      await expect(m.call(name, raw, theirs), name).rejects.toThrow(RunNotFound)
    }
    expect(await status(mine.runId)).toBe('claimed')
    await m.e.drain()
  })

  it('does not let the lease token of one run submit or attach to another run', async () => {
    await m.e.drain()
    const first = await m.begin()
    const second = await m.begin()
    const a = await m.claimed(m.alpha)
    const b = await m.claimed(m.alpha, 'builder', 2)
    expect(new Set([first, second]).size).toBe(2)
    const cross = { runId: b.runId, leaseToken: a.leaseToken }
    await expect(m.call('submit', { ...cross, result: { verdict: 'accept' } }, m.agent(m.alpha))).rejects.toThrow(
      WrongLeaseToken,
    )
    await expect(
      m.call('attach_proof', { ...cross, criterion: 'c1', kind: 'output', sha: 's', body: 'b' }, m.agent(m.alpha)),
    ).rejects.toThrow(WrongLeaseToken)
    await expect(m.call('heartbeat', cross, m.agent(m.alpha))).rejects.toThrow(WrongLeaseToken)
    expect(await status(b.runId)).toBe('claimed')
    expect(await rows(sql`SELECT 1 FROM "proofs"`)).toEqual([])
    await m.e.drain()
  })
})
