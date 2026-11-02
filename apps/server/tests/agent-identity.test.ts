import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

let payload: Payload
let fake: FakeBackend
let ws: number
let product: number
let owner: Record<string, any> & { id: number }
let other: Record<string, any> & { id: number }
let keyLib: typeof import('../src/lib/api-key')
let mcp: typeof import('../src/lib/mcp-tools')
let agent: { kind: 'agent'; keyId: number | string }
const human = { kind: 'human' } as const
const o = { overrideAccess: true } as const
const repo = 'acme/web'

/** Every owner decision. approve_production (ticket #84, PR 160) joins by adding its name here and `access: 'human'` on the tool. */
const GATES = ['approve', 'accept_staging', 'grant_review_round', 'stop_review', 'request_changes', 'approve_production']

beforeAll(async () => {
  const base = process.env.DATABASE_URL ?? 'postgres://bauherr:bauherr@127.0.0.1:54330/bauherr'
  const admin = new pg.Client({ connectionString: base })
  await admin.connect()
  await admin.query('DROP DATABASE IF EXISTS bauherr_test_166_agent_identity WITH (FORCE)')
  await admin.query('CREATE DATABASE bauherr_test_166_agent_identity')
  await admin.end()
  process.env.DATABASE_URL = base.replace(/\/[^/]+$/, '/bauherr_test_166_agent_identity')
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  keyLib = await import('../src/lib/api-key')
  mcp = await import('../src/lib/mcp-tools')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'session' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
  const user = (email: string) => payload.create({ collection: 'bauherren', data: { email, password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
  ;[owner, other] = (await Promise.all([user('owner@x.io'), user('other@x.io')])) as [typeof owner, typeof other]
  const token = await keyLib.mintAgentKey(payload, owner, 'laptop')
  agent = { kind: 'agent', keyId: (await keyLib.resolveAgentKey(payload, token))!.keyId }
})

afterAll(async () => {
  await payload?.destroy()
})

const call = (actor: Parameters<typeof mcp.callTool>[0]['actor'], name: string, input: unknown) => mcp.callTool({ payload, user: owner, actor }, name, input)
const ticket = async (stage: string) => {
  const issue = await fake.tickets(repo).create({ title: 't', labels: [`bauherr:stage:${stage}`] })
  const t = await payload.create({ collection: 'tickets', data: { title: 't', externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage, product, workspace: ws }, ...o })
  return t.id as number
}
const count = async (collection: string, where: Record<string, unknown> = {}) => (await payload.count({ collection, where: where as never, ...o })).totalDocs

it('mint, resolve, revoke: only the hash is stored, a revoked key stops resolving', async () => {
  const token = await keyLib.mintAgentKey(payload, other, 'ci box')
  expect(token).toMatch(/^bha_[0-9a-f]{64}$/)
  const [row] = (await payload.find({ collection: 'agent_keys', where: { label: { equals: 'ci box' } }, showHiddenFields: true, ...o })).docs as any[]
  expect(row.keyHash).toMatch(/^[0-9a-f]{64}$/)
  expect(JSON.stringify(row)).not.toContain(token)
  expect(row.prefix).toBe(token.slice(0, 8))
  const hit = await keyLib.resolveAgentKey(payload, token)
  expect(hit).toMatchObject({ keyId: row.id, owner: { email: 'other@x.io' } })
  expect((await payload.findByID({ collection: 'agent_keys', id: row.id, ...o })).lastUsedAt).toBeTruthy()
  await expect(keyLib.revokeAgentKey(payload, owner, row.id)).rejects.toThrow('No such agent key')
  await keyLib.revokeAgentKey(payload, other, row.id)
  expect(await keyLib.resolveAgentKey(payload, token)).toBeNull()
  expect(await keyLib.resolveAgentKey(payload, 'bha_unknown')).toBeNull()
})

it.each(GATES)('%s refuses an agent key: no human touch, tool_calls row has status error and the key', async (name) => {
  const touches = await count('human_touches')
  await expect(call(agent, name, { ticket: 1, gate: 'plan', note: 'n' })).rejects.toThrow(`forbidden: ${name} needs a human`)
  expect(await count('human_touches')).toBe(touches)
  const row = (await payload.find({ collection: 'tool_calls', where: { name: { equals: name } }, sort: '-createdAt', limit: 1, depth: 0, ...o })).docs[0] as any
  expect(row).toMatchObject({ status: 'error', agentKey: agent.keyId })
})

it('with a human actor the gate tools work and every human touch names a person', async () => {
  expect(await call(human, 'approve', { ticket: await ticket('plan'), gate: 'plan' })).toEqual({ approved: 'bauherr:approved:plan' })
  expect(await call(human, 'accept_staging', { ticket: await ticket('release') })).toMatchObject({ approved: 'bauherr:approved:staging' })
  expect(await call(human, 'request_changes', { ticket: await ticket('release'), note: 'again' })).toMatchObject({ stage: 'build' })
  const touches = (await payload.find({ collection: 'human_touches', pagination: false, ...o })).docs as any[]
  expect(touches.length).toBeGreaterThanOrEqual(3)
  for (const t of touches) expect(t.actor).toContain('@')
  const row = (await payload.find({ collection: 'tool_calls', where: { name: { equals: 'approve' } }, sort: '-createdAt', limit: 1, depth: 0, ...o })).docs[0] as any
  expect(row).toMatchObject({ status: 'ok', agentKey: null })
})

it('registry: every tool carries an explicit classification, gate-like names are human, the human set is exactly GATES', () => {
  for (const t of mcp.tools) expect(['agent', 'human'], `${t.name} needs access: 'agent' | 'human'`).toContain((t as { access?: string }).access)
  for (const t of mcp.tools.filter((t) => /approve|accept|grant|stop_review|request_changes|production/.test(t.name))) expect(t.access, t.name).toBe('human')
  expect(mcp.tools.filter((t) => t.access === 'human').map((t) => t.name).sort()).toEqual([...GATES].sort())
  for (const name of ['claim_run', 'claim_next', 'submit_plan', 'finish_run', 'submit_review', 'release_run', 'post_staging_summary']) {
    expect(mcp.tools.find((t) => t.name === name)?.access).toBe('agent')
  }
})

it('callTool is fail-closed: an unclassified tool is refused for an agent key', async () => {
  const run = async () => 'ran'
  mcp.tools.push({ name: 'unclassified_probe', description: '', inputSchema: { type: 'object', properties: {} }, run } as never)
  try {
    await expect(call(agent, 'unclassified_probe', {})).rejects.toThrow('forbidden: unclassified_probe needs a human')
    await expect(call(human, 'unclassified_probe', {})).resolves.toBe('ran')
  } finally {
    mcp.tools.pop()
  }
})

it('replaceAgentKey revokes the previous key with that label, so re-seeding does not accumulate', async () => {
  const first = await keyLib.replaceAgentKey(payload, owner, 'seed')
  const second = await keyLib.replaceAgentKey(payload, owner, 'seed')
  expect(await keyLib.resolveAgentKey(payload, first)).toBeNull()
  expect(await keyLib.resolveAgentKey(payload, second)).not.toBeNull()
  expect(await count('agent_keys', { label: { equals: 'seed' }, revokedAt: { exists: false } })).toBe(1)
})

/** Exempt: the poller records the forge login of a manual gate-owner label (`ev.actor`) and copies the parent's approving person to inherited children (`approval?.actor`). */
it('every human_touches writer names the person through personOf', () => {
  const files = execSync("grep -rl \"collection: 'human_touches'\" src --include=*.ts --include=*.tsx", { cwd: process.cwd(), encoding: 'utf8' }).trim().split('\n')
  expect(files.length).toBeGreaterThan(1)
  for (const f of files) {
    for (const line of readFileSync(f, 'utf8').split('\n').filter((l, i, all) => all.slice(Math.max(0, i - 3), i + 4).some((x) => x.includes("collection: 'human_touches'")) && /\bactor\s*[:,}]/.test(l) && !/actor: (ev\.actor|approval\?\.actor)/.test(l))) {
      expect(line, f).toContain('personOf(')
    }
  }
})

it('claiming with an agent key records the key on the Run; a personal claim leaves it empty', async () => {
  const claim = async (actor: Parameters<typeof call>[0]) => {
    const t = await ticket('plan')
    const run = await payload.create({ collection: 'runs', data: { ticket: t, stage: 'plan', mode: 'session', status: 'awaiting_session', workspace: ws }, ...o })
    await call(actor, 'claim_run', { runId: run.id })
    return (await payload.findByID({ collection: 'runs', id: run.id, depth: 0, ...o })) as any
  }
  expect(await claim(agent)).toMatchObject({ status: 'running', agentKey: agent.keyId })
  expect((await claim(human)).agentKey).toBeNull()
})

it('a human touch needs a named person', async () => {
  const { acceptStaging } = await import('../src/lib/actions')
  await expect(acceptStaging(payload, { ...owner, email: '' }, { ticket: await ticket('release') })).rejects.toThrow('named person')
})
