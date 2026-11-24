import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createTestDb, type TestDb } from './helpers/test-db'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('../src/app/(app)/lib/session', () => ({
  currentWorkspace: async () => signedIn,
  payloadClient: async () => payload,
  workspacesOf: async () => [],
}))

const o = { overrideAccess: true } as const
const num = (value: unknown) => z.coerce.number().parse(value)
let payload: Payload
let signedIn: unknown
let testDb: TestDb

beforeAll(async () => {
  testDb = await createTestDb('readiness_fix')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

const actions = () => import('../src/app/(app)/(shell)/settings/products/[id]/actions')
const read = async (product: number) =>
  z.record(z.string(), z.unknown()).parse(await payload.findByID({ collection: 'products', id: product, ...o }))

const setup = async (slug: string, role: 'admin' | 'bauherr' = 'admin') => {
  const created = await payload.create({ collection: 'workspaces', data: { name: slug, slug }, ...o })
  const workspace = num(created.id)
  const user = await payload.create({
    collection: 'bauherren',
    data: { email: `${slug}@x.io`, password: 'pw-123456', role, tenants: [{ tenant: workspace }] },
    ...o,
  })
  const made = await payload.create({ collection: 'products', data: { name: slug, slug, workspace }, ...o })
  const product = num(made.id)
  const connection = await payload.create({
    collection: 'connections',
    data: { name: slug, kind: 'github', config: {}, secret: 'x', workspace },
    ...o,
  })
  const row = await payload.create({
    collection: 'ticket_sources',
    data: { repo: `acme/${slug}`, product, connection: num(connection.id), workspace },
    ...o,
  })
  await payload.db.drizzle.execute(sql`UPDATE "ticket_sources" SET "has_agents_file" = true,
    "agents_file" = ${'`pnpm test`'}, "issue_form_count" = 1, "facts_at" = now()
    WHERE "id" = ${num(row.id)}`)
  const sets = JSON.stringify([{ name: 'auth', paths: ['src/auth/**'] }])
  await payload.db.drizzle.execute(sql`INSERT INTO "instance_state" ("key", "value")
    VALUES (${`risk-suggestions:${num(row.id)}`}, ${sets}::jsonb)`)
  const pull = await payload.create({
    collection: 'mirror_items',
    data: {
      workspace, source: num(row.id), product, repo: `acme/${slug}`, number: 1, kind: 'pr', title: 'p', state: 'open',
      forgeCreatedAt: new Date().toISOString(),
    },
    ...o,
  })
  for (const name of ['lint', 'test']) {
    await payload.create({
      collection: 'mirror_checks',
      data: { workspace, item: num(pull.id), sha: 'abc', name, status: 'completed', conclusion: 'success' },
      ...o,
    })
  }
  signedIn = { user, workspaces: [], workspace: created }
  return { workspace, product }
}

describe('saveReadinessFix', () => {
  it('saves the proposed required checks and refuses a second press once they are set', async () => {
    const { saveReadinessFix } = await actions()
    const { product } = await setup('fix-checks')
    const send = () => saveReadinessFix({}, form({ id: String(product), check: 'required-checks' }))
    expect((await send()).saved).toBe(true)
    expect(await read(product)).toMatchObject({ requiredChecks: 'lint, test' })
    expect((await send()).error).toContain('gone')
  })

  it('adds the suggested path sets and chooses them as risk areas', async () => {
    const { saveReadinessFix } = await actions()
    const { product } = await setup('fix-areas')
    const result = await saveReadinessFix({}, form({ id: String(product), check: 'risk-areas' }))
    expect(result.saved).toBe(true)
    expect(await read(product)).toMatchObject({ riskAreas: ['auth'], pathSets: { auth: ['src/auth/**'] } })
  })

  it('refuses a check that has no setting fix and an unknown check', async () => {
    const { saveReadinessFix } = await actions()
    const { product } = await setup('fix-none')
    expect((await saveReadinessFix({}, form({ id: String(product), check: 'agents-file' }))).error).toContain('gone')
    expect((await saveReadinessFix({}, form({ id: String(product), check: 'nonsense' }))).error).toContain('Unknown')
    expect(await read(product)).toMatchObject({ requiredChecks: null, riskAreas: [] })
  })

  it('refuses a member who is not an Admin and a Product of another Workspace', async () => {
    const mod = await actions()
    const { product } = await setup('fix-member', 'bauherr')
    for (const name of ['saveReadinessFix', 'checkReadinessNow'] as const) {
      const result = await mod[name]({}, form({ id: String(product), check: 'required-checks' }))
      expect(result.error, name).toBeTruthy()
    }
    expect(await read(product)).toMatchObject({ requiredChecks: null, riskAreas: [] })
    const { product: foreign } = await setup('fix-foreign')
    await setup('fix-mine')
    for (const name of ['saveReadinessFix', 'checkReadinessNow'] as const) {
      const result = await mod[name]({}, form({ id: String(foreign), check: 'required-checks' }))
      expect(result.error, name).toBe('Not in this Workspace')
    }
    expect(await read(foreign)).toMatchObject({ requiredChecks: null })
  })
})
