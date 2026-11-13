import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let signedIn: { user: Record<string, any>; workspace: { id: number } }
vi.mock('../src/app/(app)/lib/session', () => ({ currentWorkspace: async () => signedIn, payloadClient: async () => payload, workspacesOf: async (u: { role: string }) => (u.role === 'admin' ? [] : [{ id: ws }]) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
let actions: typeof import('../src/app/(app)/(shell)/settings/actions')
let ws: number
let other: number
let product: number
let admin: Record<string, any>
let member: Record<string, any>
const o = { overrideAccess: true, depth: 0 } as const
const form = (data: Record<string, string | number>) => Object.entries(data).reduce((fd, [k, v]) => (fd.set(k, String(v)), fd), new FormData())
const docsRuns = async () => (await payload.count({ collection: 'runs', where: { stage: { equals: 'docs' } }, ...o })).totalDocs
const paths = async () => ((await payload.findByID({ collection: 'products', id: product, ...o })) as Record<string, any>).docsCheck?.paths

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('docs_check_actions')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  actions = await import('../src/app/(app)/(shell)/settings/actions')
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'docs', slug: 'docs' }, ...o })).id as number
  other = (await payload.create({ collection: 'workspaces', data: { name: 'other', slug: 'other' }, ...o })).id as number
  admin = await payload.create({ collection: 'bauherren', data: { email: 'admin@docs.io', password: 'pw-123456', role: 'admin' }, ...o })
  member = await payload.create({ collection: 'bauherren', data: { email: 'member@docs.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
  product = (await payload.create({ collection: 'products', data: { name: 'Shop', slug: 'shop', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo: 'acme/shop', product, connection, workspace: ws }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

describe('docs check actions', () => {
  it('refuse a non-Admin and an Admin working in another Workspace, and change nothing', async () => {
    for (const who of [{ user: member, workspace: { id: ws } }, { user: admin, workspace: { id: other } }]) {
      signedIn = who
      expect(await actions.saveDocsCheck({}, form({ id: product, paths: 'evil/**' }))).toMatchObject({ error: expect.any(String) })
      expect(await actions.startDocsCheckAction({}, form({ id: product }))).toMatchObject({ error: expect.any(String) })
    }
    expect(await docsRuns()).toBe(0)
    expect((await paths()) ?? ['README.md', 'docs/**/*.md']).toEqual(['README.md', 'docs/**/*.md'])
    expect((await payload.count({ collection: 'tickets', ...o })).totalDocs).toBe(0)
  })

  it('an Admin saves the paths and starts one check', async () => {
    signedIn = { user: admin, workspace: { id: ws } }
    expect(await actions.saveDocsCheck({}, form({ id: product, paths: 'README.md\ndocs/**/*.md\nCHANGELOG.md' }))).toMatchObject({ saved: true })
    expect(await paths()).toEqual(['README.md', 'docs/**/*.md', 'CHANGELOG.md'])
    expect(await actions.startDocsCheckAction({}, form({ id: product }))).toMatchObject({ saved: true })
    expect(await actions.startDocsCheckAction({}, form({ id: product }))).toMatchObject({ saved: true })
    expect(await docsRuns()).toBe(1)
  })

  it('refuse globs that leave the repository or break the Ticket text', async () => {
    signedIn = { user: admin, workspace: { id: ws } }
    for (const bad of ['/etc/passwd', '../secrets/**', 'docs/../../x', 'docs/`x`.md', 'a b.md', '']) {
      expect(await actions.saveDocsCheck({}, form({ id: product, paths: bad }))).toMatchObject({ fields: { paths: expect.any(String) } })
    }
    expect(await paths()).toEqual(['README.md', 'docs/**/*.md', 'CHANGELOG.md'])
  })
})
