/**
 * MCP transport test against a real `next dev`. Needs Postgres: set MCP_E2E_DATABASE_URL
 * (any database on a server you can CREATE DATABASE in); skipped without it (CI without Postgres).
 * Run: MCP_E2E_DATABASE_URL=postgres://u:p@127.0.0.1:5432/postgres pnpm --filter server test:mcp
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import pg from 'pg'

const base = process.env.MCP_E2E_DATABASE_URL
const PORT = 3111
const API_KEY = 'e2e-api-key-0123456789'
let dev: ChildProcess | undefined
let stub: ReturnType<typeof createServer> | undefined
let runId: number | string
const assigned: string[] = []

const rpc = async (method: string, params: unknown, key: string | null = API_KEY) => {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  return { status: res.status, body: res.status === 200 ? await res.json() : null }
}
const call = async (name: string, args: unknown) => {
  const { body } = await rpc('tools/call', { name, arguments: args })
  const text = body.result.content[0].text as string
  return { isError: !!body.result.isError, text, json: body.result.isError ? null : JSON.parse(text) }
}

before(async () => {
  if (!base) return
  const admin = new pg.Client({ connectionString: base })
  await admin.connect()
  await admin.query('DROP DATABASE IF EXISTS bauherr_e2e WITH (FORCE)')
  await admin.query('CREATE DATABASE bauherr_e2e')
  await admin.end()
  Object.assign(process.env, { DATABASE_URL: base.replace(/\/[^/]+$/, '/bauherr_e2e'), PAYLOAD_SECRET: 'e2e', ENCRYPTION_KEY: 'e2e', JOBS_AUTORUN: '0' })

  stub = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.method === 'POST' && req.url?.endsWith('/assignees')) {
      assigned.push(req.url)
      return void res.end(JSON.stringify({ assignees: [{ login: 'bot' }] }))
    }
    if (req.url?.includes('/dependencies/')) return void res.end('[]')
    res.end(JSON.stringify({ id: 1, number: 1, html_url: 'u', title: 't', state: 'open', labels: [], assignee: null, updated_at: '2026-01-01T00:00:00Z', body: '## Acceptance criteria\n- tests pass' }))
  })
  await new Promise<void>((r) => stub!.listen(0, '127.0.0.1', r))
  const apiUrl = `http://127.0.0.1:${(stub.address() as { port: number }).port}`

  const { getPayload } = await import('payload')
  const payload = await getPayload({ config: (await import('../src/payload.config')).default })
  const o = { overrideAccess: true } as const
  await payload.create({ collection: 'bauherren', data: { email: 'admin@e2e.test', password: 'pw-admin-12345' }, ...o } as never)
  const workspace = (await payload.create({ collection: 'workspaces', data: { name: 'w', slug: 'w', defaultMode: 'session' }, ...o })).id
  const product = (await payload.create({ collection: 'products', data: { name: 'p', slug: 'p', workspace }, ...o })).id
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', secret: 'pat', config: { apiUrl }, workspace }, ...o })).id
  await payload.create({ collection: 'ticket_sources', data: { repo: 'o/r', product, connection, workspace }, ...o })
  const ticket = await payload.create({ collection: 'tickets', data: { title: 't', externalId: '1', number: 1, state: 'open', stage: 'plan', product, workspace }, ...o })
  runId = (await payload.create({ collection: 'runs', data: { ticket: ticket.id, stage: 'plan', mode: 'session', status: 'awaiting_session', workspace }, ...o })).id
  await payload.create({
    collection: 'bauherren',
    data: { email: 'dev@e2e.test', password: 'pw-dev-12345', role: 'bauherr', githubLogin: 'bot', tenants: [{ tenant: workspace }], enableAPIKey: true, apiKey: API_KEY },
    ...o,
  } as never)
  await payload.destroy()

  dev = spawn('npx', ['next', 'dev', '--port', String(PORT)], { stdio: 'ignore', env: process.env, detached: true })
  for (let i = 0; i < 120; i++) {
    if ((await fetch(`http://127.0.0.1:${PORT}/mcp`).catch(() => null))?.status === 401) return
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('dev server did not start')
})

after(async () => {
  if (dev?.pid) process.kill(-dev.pid)
  stub?.close()
})

test('rejects calls without a valid API key', { skip: !base }, async () => {
  assert.equal((await rpc('tools/list', {}, null)).status, 401)
  assert.equal((await rpc('tools/list', {}, 'wrong')).status, 401)
})

test('list_frontier and claim_run over HTTP', { skip: !base }, async () => {
  const list = await rpc('tools/list', {})
  assert.ok(list.body.result.tools.some((t: { name: string }) => t.name === 'claim_run'))

  const frontier = (await call('list_frontier', {})).json
  assert.equal(frontier.length, 1)
  assert.deepEqual(frontier[0].run, { id: runId, stage: 'plan', status: 'awaiting_session', mode: 'session' })
  assert.equal(frontier[0].claimable, true)

  const claimed = await call('claim_run', { runId })
  assert.equal(claimed.json.run.status, 'running')
  assert.deepEqual(claimed.json.goal, ['tests pass'])
  assert.equal(assigned.length, 1)

  assert.equal((await call('claim_run', { runId })).isError, true)
  assert.equal((await call('heartbeat', { runId })).isError, true)
  assert.equal((await call('heartbeat', { runId, leaseToken: claimed.json.leaseToken })).json.ok, true)
  assert.equal((await call('list_frontier', {})).json[0].run.status, 'running')
})
