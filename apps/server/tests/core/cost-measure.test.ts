import { sql } from '@payloadcms/db-postgres'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { measureOutsideRuns, measureRuns, outsideCost } from '../../src/core/cost-store'
import { claim } from '../../src/core/run/leases'
import { gatewayRequests } from '../../src/lib/gateway-usage'
import { createTestDb, type TestDb } from '../helpers/test-db'
import { openMcp, type Mcp } from './mcp-harness'

vi.mock('../../src/lean', async () => ({
  MODULES: (await import('./harness')).TEST_MODULES,
  skillFor: () => Promise.resolve(null),
  tierFor: () => Promise.resolve('standard'),
}))

const SESSION = 'cd5bf185-80de-4e54-b55d-5ff31f901fea'
const MINUTE = 60_000
let m: Mcp
let gw: pg.Client
let gwDb: TestDb
let route: typeof import('../../src/app/mcp/route')

beforeAll(async () => {
  m = await openMcp('core_cost_measure')
  gwDb = await createTestDb('core_cost_gw')
  process.env.GATEWAY_DATABASE_URL = gwDb.url
  gw = new pg.Client({ connectionString: gwDb.url })
  await gw.connect()
  await gw.query(`CREATE TABLE request_logs (id serial PRIMARY KEY, started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz, http_status int, cost numeric, input_tokens int, output_tokens int,
    gen_ai_request_model text, gen_ai_response_model text, agentgateway_user text, attributes_json jsonb)`)
  route = await import('../../src/app/mcp/route')
}, 120_000)
afterAll(async () => {
  await gw?.end()
  await m?.e.drop()
  await gwDb?.drop()
})
beforeEach(async () => {
  await gw.query('DELETE FROM request_logs')
  await m.e.db.payload.db.drizzle.execute(sql`DELETE FROM "stage_runs"`)
  await m.e.db.payload.db.drizzle.execute(sql`DELETE FROM "instance_state"`)
})

const rpc = (name: string, args: unknown): Request =>
  new Request('http://t/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${m.alpha.agentToken}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  })

const reply = z.object({
  result: z.object({ content: z.array(z.object({ text: z.string() })), isError: z.boolean().optional() }),
})

const call = async (name: string, args: unknown): Promise<Record<string, unknown>> => {
  const { result } = reply.parse(await (await route.POST(rpc(name, args))).json())
  expect(result.isError, result.content[0]?.text).not.toBe(true)
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>
}

const agoMinutes = (n: number): Date => new Date(Date.now() - n * MINUTE)

const log = (
  at: Date,
  o: { user?: string; session?: string | null; run?: string; cost?: number | null; status?: number } = {},
) =>
  gw.query(
    `INSERT INTO request_logs (started_at, http_status, cost, input_tokens, output_tokens, agentgateway_user,
      attributes_json) VALUES ($1, $2, $3, 100, 20, $4, $5)`,
    [
      at,
      o.status ?? 200,
      o.cost === undefined ? 0.5 : o.cost,
      o.user ?? 'workspace-alpha',
      JSON.stringify({
        ...(o.session === null ? {} : { 'agentgateway.session': o.session ?? SESSION }),
        ...(o.run === undefined ? {} : { run: o.run }),
      }),
    ],
  )

const place = (runId: number, startedAgo: number, endedAgo: number) =>
  m.e.db.payload.db.drizzle.execute(sql`
    UPDATE "stage_runs" SET "started_at" = ${agoMinutes(startedAgo).toISOString()},
      "finished_at" = ${agoMinutes(endedAgo).toISOString()}, "status" = 'released' WHERE "id" = ${runId}`)

const row = async (runId: number) =>
  (
    await m.e.db.payload.db.drizzle.execute(sql`
      SELECT "cost_usd", "cost_source", "input_tokens", "output_tokens", "client_session", "cost_measured_at"
      FROM "stage_runs" WHERE "id" = ${runId}`)
  ).rows[0]

const claimOverMcp = async (clientSession: string, capacity = 1) => {
  const { session } = z
    .object({ session: z.string() })
    .parse(await call('connect', { role: 'builder', capacity, clientSession }))
  const runs: number[] = []
  for (let i = 0; i < capacity; i++) {
    await m.begin()
    const work = z.object({ runId: z.number() }).parse(await call('next_work', { session }))
    runs.push(work.runId)
  }
  return runs
}

describe('the link over /mcp', () => {
  it('stores the Claude Code session id the agent gave on connect and puts it on each run it claims', async () => {
    const [runId] = await claimOverMcp(SESSION)
    expect((await row(runId ?? 0))?.client_session).toBe(SESSION)
    const stored = await m.e.db.payload.db.drizzle.execute(
      sql`SELECT "client_session" FROM "agent_sessions" ORDER BY "id" DESC LIMIT 1`,
    )
    expect(stored.rows[0]?.client_session).toBe(SESSION)
  })

  it('refuses a connect without the session id and tells the agent what to do', async () => {
    const refused = reply.parse(await (await route.POST(rpc('connect', { role: 'builder' }))).json()).result
    expect(refused.isError).toBe(true)
    expect(JSON.stringify(refused)).toContain(
      'Pass clientSession: run printenv CLAUDE_CODE_SESSION_ID in your shell and call connect again with its value.',
    )
  })

  it('refuses an id that is not a plain session id', async () => {
    const refused = rpc('connect', { role: 'builder', clientSession: 'a b;c' })
    expect(reply.parse(await (await route.POST(refused)).json()).result.isError).toBe(true)
  })

  it('tells the agent in the instructions and in the field where to find the id', async () => {
    const { AGENT_INSTRUCTIONS } = await import('../../src/core/run/mcp/instructions')
    expect(AGENT_INSTRUCTIONS).toContain('printenv CLAUDE_CODE_SESSION_ID')
    const { TOOLS } = await import('../../src/core/run/mcp/registry')
    const tool = TOOLS.find((entry) => entry.name === 'connect')
    const schema = z.object({ properties: z.record(z.string(), z.object({ description: z.string().optional() })) })
    const fields = schema.parse(z.toJSONSchema(tool?.input ?? z.object({}), { io: 'input' })).properties
    expect(fields.clientSession?.description).toContain('CLAUDE_CODE_SESSION_ID')
  })
})

describe('measuring a run', () => {
  it('sums the gateway cost of the session between claim and end, from the request log to stage_runs', async () => {
    const [runId = 0] = await claimOverMcp(SESSION)
    await place(runId, 60, 30)
    await log(agoMinutes(50), { cost: 0.5 })
    await log(agoMinutes(40), { cost: 0.25 })
    await log(agoMinutes(20), { cost: 9 })
    await log(agoMinutes(45), { cost: 9, user: 'workspace-beta' })
    await log(agoMinutes(45), { cost: 9, status: 500 })
    await log(agoMinutes(45), { cost: 9, session: 'someone-elses-session' })
    expect(await measureRuns(m.e.db.payload, gatewayRequests, new Date())).toBe(1)
    expect(await row(runId)).toMatchObject({ cost_source: 'gateway', input_tokens: '200', output_tokens: '40' })
    expect(Number((await row(runId))?.cost_usd)).toBeCloseTo(0.75)
  })

  it('splits one request over the two runs a session held at once', async () => {
    const [a = 0, b = 0] = await claimOverMcp(SESSION, 2)
    await place(a, 60, 30)
    await place(b, 50, 20)
    await log(agoMinutes(55), { cost: 1 })
    await log(agoMinutes(40), { cost: 1 })
    await log(agoMinutes(25), { cost: 1 })
    await measureRuns(m.e.db.payload, gatewayRequests, new Date())
    expect(Number((await row(a))?.cost_usd)).toBeCloseTo(1.5)
    expect(Number((await row(b))?.cost_usd)).toBeCloseTo(1.5)
    expect(Number((await row(a))?.input_tokens)).toBeCloseTo(150)
  })

  it('keeps the tokens but leaves the cost null when a request has no price', async () => {
    const [runId = 0] = await claimOverMcp(SESSION)
    await place(runId, 60, 30)
    await log(agoMinutes(50), { cost: 0.5 })
    await log(agoMinutes(40), { cost: null })
    await measureRuns(m.e.db.payload, gatewayRequests, new Date())
    expect(await row(runId)).toMatchObject({ cost_usd: null, cost_source: null, input_tokens: '200' })
  })

  it('leaves a run without requests null and never zero', async () => {
    const silent = (await claimOverMcp('a-session-with-no-requests'))[0] ?? 0
    await place(silent, 60, 30)
    await log(agoMinutes(40), { cost: 1 })
    await measureRuns(m.e.db.payload, gatewayRequests, new Date())
    expect(await row(silent)).toMatchObject({ cost_usd: null, cost_source: null, input_tokens: null })
  })

  it('measures a Runner run by the run id its requests carry', async () => {
    const id = await m.e.db.fresh()
    const queued = sql`UPDATE "stage_runs" SET "status" = 'released' WHERE "status" = 'queued'`
    await m.e.db.payload.db.drizzle.execute(queued)
    const { enqueue } = await import('../../src/core/run/leases')
    const { run } = await enqueue(m.e.db.payload, id, { stage: 'build', role: 'builder', fingerprint: 'runner-fp' })
    const claimed = await claim(m.e.db.payload, {
      workspace: m.e.db.workspace,
      role: 'builder',
      by: 'runner-builder',
      now: agoMinutes(60),
    })
    expect(claimed?.run.id).toBe(run.id)
    await place(run.id, 60, 30)
    await log(agoMinutes(40), { session: null, run: String(run.id), cost: 0.4 })
    await log(agoMinutes(40), { session: null, run: String(run.id + 1000), cost: 9 })
    await measureRuns(m.e.db.payload, gatewayRequests, new Date())
    expect(await row(run.id)).toMatchObject({ cost_source: 'gateway' })
    expect(Number((await row(run.id))?.cost_usd)).toBeCloseTo(0.4)
  })

  it('waits five minutes for late logs, measures again hourly, and repeats the same numbers', async () => {
    const [runId = 0] = await claimOverMcp(SESSION)
    await place(runId, 60, 3)
    await log(agoMinutes(30), { cost: 0.5 })
    const payload = m.e.db.payload
    expect(await measureRuns(payload, gatewayRequests, new Date())).toBe(0)
    const later = new Date(Date.now() + 3 * MINUTE)
    expect(await measureRuns(payload, gatewayRequests, later)).toBe(1)
    const first = await row(runId)
    expect(await measureRuns(payload, gatewayRequests, new Date(later.getTime() + 10 * MINUTE))).toBe(0)
    await log(agoMinutes(20), { cost: 0.25 })
    const hour = new Date(later.getTime() + 61 * MINUTE)
    expect(await measureRuns(payload, gatewayRequests, hour)).toBe(1)
    expect(Number((await row(runId))?.cost_usd)).toBeCloseTo(0.75)
    expect(await measureRuns(payload, gatewayRequests, new Date(hour.getTime() + 61 * MINUTE))).toBe(1)
    expect(Number((await row(runId))?.cost_usd)).toBeCloseTo(0.75)
    expect(first).toMatchObject({ cost_source: 'gateway' })
  })

  it('stops measuring a run that ended more than a day ago', async () => {
    const [runId = 0] = await claimOverMcp(SESSION)
    await place(runId, 26 * 60, 25 * 60)
    await log(agoMinutes(25 * 60 + 30), { cost: 1 })
    expect(await measureRuns(m.e.db.payload, gatewayRequests, new Date())).toBe(0)
  })
})

describe('cost outside runs', () => {
  it('counts what the sessions of the Workspace spent in no run, by day, and backfills once', async () => {
    const [runId = 0] = await claimOverMcp(SESSION)
    await place(runId, 60, 30)
    await log(agoMinutes(45), { cost: 5 })
    await log(agoMinutes(90), { cost: 0.4 })
    await log(agoMinutes(10 * 24 * 60), { cost: 0.1 })
    await log(agoMinutes(90), { cost: 7, user: 'workspace-beta' })
    await log(agoMinutes(90), { cost: 7, session: 'unknown-session' })
    const payload = m.e.db.payload
    await measureOutsideRuns(payload, gatewayRequests, new Date())
    const stored = await outsideCost(payload, m.e.db.workspace)
    const total = Object.values(stored?.days ?? {}).reduce((sum, cost) => sum + cost, 0)
    expect(total).toBeCloseTo(0.5)
    expect(await outsideCost(payload, m.e.db.otherWorkspace)).toBeNull()
    await measureOutsideRuns(payload, gatewayRequests, new Date(Date.now() + 10 * MINUTE))
    const again = await outsideCost(payload, m.e.db.workspace)
    expect(Object.values(again?.days ?? {}).reduce((sum, cost) => sum + cost, 0)).toBeCloseTo(0.5)
  })
})
