import type { Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeBackend } from '@bauherr/adapters'
import { createTestDb, type TestDb } from './helpers/test-db'

const backend = vi.hoisted(() => ({ current: null as unknown as FakeBackend }))
vi.mock('../src/lib/adapters', () => ({ backendFor: () => backend.current }))

const REPO = 'acme/knowledge'
const PATH = 'workspace/rules/style.md'
const o = { overrideAccess: true } as const
let payload: Payload
let edit: typeof import('../src/lib/knowledge-edit')
let jobs: typeof import('../src/jobs')
let member: Record<string, any>
let ws: number

const handle = (task: { handler: unknown }) => (task.handler as (a: unknown) => Promise<{ output: Record<string, any> }>)({ req: { payload } })

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('watch_tasks')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  edit = await import('../src/lib/knowledge-edit')
  jobs = await import('../src/jobs')
  ws = Number((await payload.create({ collection: 'workspaces', data: { name: 'a', slug: 'a' }, ...o })).id)
  const conn = await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o } as never)
  await payload.update({ collection: 'workspaces', id: ws, data: { knowledgeConnection: conn.id, knowledgeRepo: REPO }, ...o })
  member = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
})

beforeEach(() => {
  backend.current = new FakeBackend()
  backend.current.commit(REPO, 'main', PATH, '# Style\n\nKeep it short.\n')
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

describe('watch-knowledge-prs', () => {
  it('reports no merges when no editor PR is open', async () => {
    expect((await handle(jobs.watchKnowledgePrsTask)).output).toEqual({ merged: 0 })
  })

  it('merges a recorded editor PR with green checks and reports it', async () => {
    const sha = (await backend.current.forge.getFile(REPO, PATH)).sha
    const saved = (await edit.saveDocument(payload, member, { workspace: ws, path: PATH, content: '# Style\n\nShorter.\n', baseSha: sha })) as { pr: { number: number } }
    const pr = (await backend.current.forge.listPullRequests(REPO)).find((p) => p.number === saved.pr.number)!
    backend.current.setChecks(REPO, pr.headSha, [{ name: 'lint', status: 'completed', conclusion: 'success' }])
    expect((await handle(jobs.watchKnowledgePrsTask)).output).toEqual({ merged: 1 })
    expect((await backend.current.forge.getPullRequest(REPO, saved.pr.number)).state).toBe('merged')
  })
})

describe('watch-gateway', () => {
  it('does nothing without a gateway database and URL', async () => {
    delete process.env.GATEWAY_DATABASE_URL
    delete process.env.GATEWAY_URL
    expect((await handle(jobs.watchGatewayTask)).output).toEqual({ calls: 0 })
  })

  it('stores a down health and attributes no calls when the gateway does not answer', async () => {
    process.env.GATEWAY_DATABASE_URL = testDb.url
    process.env.GATEWAY_URL = 'http://127.0.0.1:1'
    process.env.GATEWAY_ADMIN_URL = 'http://127.0.0.1:1'
    const { loadGatewayHealth } = await import('../src/app/(app)/lib/gateway-setup')
    try {
      expect((await handle(jobs.watchGatewayTask)).output).toEqual({ calls: 0 })
      expect(await loadGatewayHealth(payload)).toMatchObject({ up: false, migration: null })
    } finally {
      delete process.env.GATEWAY_DATABASE_URL
      delete process.env.GATEWAY_URL
      delete process.env.GATEWAY_ADMIN_URL
    }
  })
})
