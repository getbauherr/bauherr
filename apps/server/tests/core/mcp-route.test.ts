import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { ItemRow } from '../../src/core/mirror/map'
import { mintAgentKey, resolveAgentKey } from '../../src/lib/api-key'
import { upsertItem } from '../../src/core/mirror/store'
import { TOOLS } from '../../src/core/run/mcp/registry'
import { openMcp, type Mcp } from './mcp-harness'

vi.mock('../../src/lean', async () => ({
  MODULES: (await import('./harness')).TEST_MODULES,
  skillFor: () => Promise.resolve(null),
}))

let m: Mcp
let route: typeof import('../../src/app/mcp/route')

beforeAll(async () => {
  m = await openMcp('core_mcp_route')
  route = await import('../../src/app/mcp/route')
}, 120_000)
afterAll(async () => {
  await m?.e.drop()
})

const rpc = (method: string, params: unknown, key?: string): Request =>
  new Request('http://t/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(key === undefined ? {} : { authorization: `Bearer ${key}` }),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })

const reply = z.object({
  result: z.object({ content: z.array(z.object({ text: z.string() })), isError: z.boolean().optional() }),
})

const call = async (key: string, name: string, args: unknown) => {
  const res = await route.POST(rpc('tools/call', { name, arguments: args }, key))
  expect(res.status).toBe(200)
  const { result } = reply.parse(await res.json())
  const text = result.content[0]?.text ?? ''
  return {
    error: result.isError === true,
    text,
    json: result.isError ? null : (JSON.parse(text) as Record<string, unknown>),
  }
}

const ok = async (key: string, name: string, args: unknown) => {
  const out = await call(key, name, args)
  expect(out.error, out.text).toBe(false)
  return out.json ?? {}
}

describe('authentication', () => {
  it.each([
    ['no key', undefined],
    ['a wrong key', 'bha_nothing'],
    ['a wrong personal key', 'f'.repeat(64)],
  ])('answers 401 before any tool code runs for %s', async (_name, key) => {
    const before = await m.e.db.payload.db.drizzle.execute(sql`SELECT count(*)::int AS n FROM "agent_sessions"`)
    for (const method of [route.POST, route.GET, route.DELETE]) {
      const req =
        method === route.POST
          ? rpc('tools/call', { name: 'connect', arguments: { role: 'builder' } }, key)
          : new Request('http://t/mcp', {
              method: method === route.GET ? 'GET' : 'DELETE',
              headers: key ? { authorization: `Bearer ${key}` } : {},
            })
      expect((await method(req)).status).toBe(401)
    }
    const after = await m.e.db.payload.db.drizzle.execute(sql`SELECT count(*)::int AS n FROM "agent_sessions"`)
    expect(after.rows).toEqual(before.rows)
  })

  it('lists agent tools for an agent key and decide for a personal key', async () => {
    const names = async (key: string) => {
      const body = z
        .object({
          result: z.object({
            tools: z.array(
              z.object({
                name: z.string(),
                inputSchema: z.object({ additionalProperties: z.literal(false).optional() }),
              }),
            ),
          }),
        })
        .parse(await (await route.POST(rpc('tools/list', {}, key))).json())
      return body.result.tools.map((t) => t.name)
    }
    expect(await names(m.alpha.agentToken)).toEqual(TOOLS.filter((t) => t.access === 'agent').map((t) => t.name))
    expect(await names(m.alpha.personalKey)).toEqual(['decide'])
  })

  it('refuses decide for an agent key and the agent tools for a personal key', async () => {
    const record = await m.begin()
    expect(
      (await call(m.alpha.agentToken, 'decide', { record, ask: 'brief', choice: 'approve', seq: 0 })).text,
    ).toMatch(/personal API key/)
    expect((await call(m.alpha.personalKey, 'connect', { role: 'builder' })).text).toMatch(/agent key/)
    expect((await m.e.view(record)).types).not.toContain('brief.approved')
    await m.e.drain()
  })
})

describe('the Workspace of a key', () => {
  const connect = (key: string) =>
    route.POST(rpc('tools/call', { name: 'connect', arguments: { role: 'builder' } }, key))
  const make = async (email: string, extra: Record<string, unknown> = {}) => {
    const { payload } = m.e.db
    const data = { email, password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: m.e.db.workspace }], ...extra }
    return payload.create({ collection: 'bauherren', data: data, overrideAccess: true })
  }

  it('refuses minting a key for a Workspace the person is not a member of', async () => {
    const user = await make('mint@x.io')
    await expect(mintAgentKey(m.e.db.payload, user, 'x', m.e.db.otherWorkspace)).rejects.toThrow(/not a member/)
    const token = await mintAgentKey(m.e.db.payload, user, 'x', m.e.db.workspace)
    expect((await resolveAgentKey(m.e.db.payload, token))?.workspace).toBe(m.e.db.workspace)
  })

  it('lets an Admin without a membership hold a key and act with it, and an ordinary Bauherr too', async () => {
    const admin = await make('admin@x.io', { role: 'admin', tenants: [] })
    const adminKey = await mintAgentKey(m.e.db.payload, admin, 'x', m.e.db.workspace)
    expect((await connect(adminKey)).status).toBe(200)
    expect((await call(adminKey, 'connect', { role: 'builder' })).error).toBe(false)
    const member = await make('member@x.io')
    const memberKey = await mintAgentKey(m.e.db.payload, member, 'x', m.e.db.workspace)
    expect((await call(memberKey, 'connect', { role: 'builder' })).error).toBe(false)
  })

  it('refuses a key of an archived Workspace until it is restored, and minting for one', async () => {
    const { archiveWorkspace, restoreWorkspace } = await import('../../src/lib/workspace-delete')
    const { payload, workspace } = m.e.db
    const admin = await make('archiver@x.io', { role: 'admin', tenants: [] })
    const key = await mintAgentKey(payload, admin, 'x', workspace)
    expect((await connect(key)).status).toBe(200)
    await archiveWorkspace(payload, { ...admin, collection: 'bauherren' }, workspace)
    expect((await connect(key)).status).toBe(401)
    await expect(mintAgentKey(payload, admin, 'y', workspace)).rejects.toThrow(/deleted/)
    await restoreWorkspace(payload, { ...admin, collection: 'bauherren' }, workspace)
    expect((await connect(key)).status).toBe(200)
  })

  it('shows the person why minting was refused', async () => {
    const user = await make('refused@x.io')
    const { run } = await import('../../src/app/(app)/lib/settings')
    const outcome = await run(() => mintAgentKey(m.e.db.payload, user, 'x', m.e.db.otherWorkspace))
    expect(outcome).toEqual({ error: 'You are not a member of that Workspace.' })
  })

  it('acts in the Workspace of the key even when the owner belongs to several', async () => {
    const user = await make('multi@x.io', {
      tenants: [{ tenant: m.e.db.workspace }, { tenant: m.e.db.otherWorkspace }],
    })
    const token = await mintAgentKey(m.e.db.payload, user, 'x', m.e.db.otherWorkspace)
    expect((await call(token, 'connect', { role: 'builder' })).error).toBe(false)
    const row = await m.e.db.payload.db.drizzle.execute(
      sql`SELECT "workspace_id" FROM "agent_sessions" ORDER BY "id" DESC LIMIT 1`,
    )
    expect(row.rows[0]?.workspace_id).toBe(m.e.db.otherWorkspace)
  })

  it('answers 401 once the owner left the Workspace or is no longer a Bauherr', async () => {
    const left = await make('left@x.io')
    const leftKey = await mintAgentKey(m.e.db.payload, left, 'x', m.e.db.workspace)
    expect((await connect(leftKey)).status).toBe(200)
    await m.e.db.payload.update({ collection: 'bauherren', id: left.id, data: { tenants: [] }, overrideAccess: true })
    expect((await connect(leftKey)).status).toBe(401)
    const demoted = await make('demoted@x.io')
    const demotedKey = await mintAgentKey(m.e.db.payload, demoted, 'x', m.e.db.workspace)
    const data = { role: 'product-owner', assignments: [{ workspace: m.e.db.workspace, scope: 'workspace' }] }
    await m.e.db.payload.update({ collection: 'bauherren', id: demoted.id, data: data, overrideAccess: true })
    expect((await connect(demotedKey)).status).toBe(401)
  })
})

describe('the nine tools through the route', () => {
  it('connect, next_work, heartbeat, search, attach_proof, submit, release, ask and decide', async () => {
    await m.e.drain()
    const key = m.alpha.agentToken
    const record = await m.begin()
    const { session } = z.object({ session: z.string() }).parse(await ok(key, 'connect', { role: 'builder' }))
    const work = z
      .object({ runId: z.number(), leaseToken: z.string(), context: z.object({ stage: z.literal('intake') }) })
      .parse(await ok(key, 'next_work', { session }))
    const lease = { runId: work.runId, leaseToken: work.leaseToken }
    expect(await ok(key, 'heartbeat', { ...lease, step: 'start' })).toHaveProperty('leaseExpiresAt')

    const connection = await m.e.db.payload.create({
      collection: 'connections',
      data: { name: 'gh', kind: 'github', workspace: m.e.db.workspace },
      overrideAccess: true,
    })
    const source = await m.e.db.payload.create({
      collection: 'ticket_sources',
      data: { repo: 'acme/web', product: m.e.db.product, connection: connection.id, workspace: m.e.db.workspace },
      overrideAccess: true,
    })
    const item: ItemRow = {
      kind: 'issue',
      number: 1,
      title: 'Crash on login',
      body: '',
      state: 'open',
      author: 'jo',
      authorTrusted: true,
      authorIsBot: false,
      labels: [],
      assignees: [],
      url: 'https://f/1',
      forgeCreatedAt: '2026-11-01T10:00:00Z',
      forgeUpdatedAt: '2026-11-01T10:00:00Z',
      forgeClosedAt: null,
      headSha: null,
      headRef: null,
      mergeSha: null,
      closes: [],
      draft: false,
    }
    const where = {
      workspace: m.e.db.workspace,
      product: m.e.db.product,
      source: z.coerce.number().parse(source.id),
      repo: 'acme/web',
    }
    await upsertItem(m.e.db.payload, where, item, m.e.clock.now)
    const found = z
      .object({ items: z.array(z.object({ title: z.string() })), knowledge: z.array(z.unknown()) })
      .parse(await ok(key, 'search', { ...lease, query: 'crash' }))
    expect(found.items.map((i) => i.title)).toEqual(['Crash on login'])

    expect(await ok(key, 'submit', { ...lease, result: { verdict: 'accept' } })).toEqual({ status: 'accepted' })
    const brief = z.object({ runId: z.number(), leaseToken: z.string() }).parse(await ok(key, 'next_work', { session }))
    const bl = { runId: brief.runId, leaseToken: brief.leaseToken }
    expect(await ok(key, 'submit', { ...bl, result: { goal: 'g', open: true } })).toEqual({ status: 'accepted' })
    expect((await m.e.view(record)).card).toMatchObject({ card: 'brief', reason: 'open-decision' })
    expect((await m.e.view(record)).waitingOn).toBe('owner')
    const seq = await m.e.seq(record)
    const approval = { record, ask: 'brief', choice: 'approve', seq, answers: { d1: 'a' } }
    expect(await ok(m.alpha.personalKey, 'decide', approval)).toEqual({ status: 'decided' })
    const build = z.object({ runId: z.number(), leaseToken: z.string() }).parse(await ok(key, 'next_work', { session }))
    const bu = { runId: build.runId, leaseToken: build.leaseToken }
    const proof = z
      .object({ proofId: z.number() })
      .parse(await ok(key, 'attach_proof', { ...bu, criterion: 'c1', kind: 'output', sha: 'abc', body: 'passed' }))
    expect(proof.proofId).toBeGreaterThan(0)
    expect(await ok(key, 'release', bu)).toEqual({ status: 'released' })
    const again = z.object({ runId: z.number(), leaseToken: z.string() }).parse(await ok(key, 'next_work', { session }))
    expect(
      await ok(key, 'ask', {
        runId: again.runId,
        leaseToken: again.leaseToken,
        question: 'Which one?',
        options: ['a', 'b'],
      }),
    ).toEqual({ status: 'asked' })
    expect((await m.e.view(record)).card).toMatchObject({ reason: 'agent', text: 'Which one?' })
    await m.e.drain()
  })

  it('does not reach the data of another Workspace', async () => {
    await m.e.drain()
    await m.begin()
    const mine = await m.claimed(m.alpha)
    const { session } = z
      .object({ session: z.string() })
      .parse(await ok(m.beta.agentToken, 'connect', { role: 'builder' }))
    expect(await ok(m.beta.agentToken, 'next_work', { session })).toEqual({ status: 'idle' })
    const out = await call(m.beta.agentToken, 'heartbeat', { runId: mine.runId, leaseToken: mine.leaseToken })
    expect(out).toMatchObject({ error: true })
    expect(out.text).toMatch(/does not exist/)
    await m.e.drain()
  })

  it('refuses unknown fields and bad input as a tool error', async () => {
    const out = await call(m.alpha.agentToken, 'connect', { role: 'builder', admin: true })
    expect(out.error).toBe(true)
    expect(out.text).toMatch(/Unrecognized key/)
  })
})

describe('the instructions of the server', () => {
  const instructionsFor = async (key: string): Promise<string | undefined> => {
    const params = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } }
    const body = z
      .object({ result: z.object({ instructions: z.string().optional() }) })
      .parse(await (await route.POST(rpc('initialize', params, key))).json())
    return body.result.instructions
  }

  it('tells an agent key how to work the queue and gives a personal key nothing', async () => {
    const text = await instructionsFor(m.alpha.agentToken)
    expect(text?.length).toBeLessThan(900)
    for (const word of ['connect', 'next_work', 'heartbeat', 'attach_proof', 'ask', 'submit', 'release', 'idle']) {
      expect(text).toContain(word)
    }
    expect(await instructionsFor(m.alpha.personalKey)).toBeUndefined()
  })
})
