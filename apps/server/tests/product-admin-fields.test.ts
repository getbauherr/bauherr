import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { type Guard, o, setupGuard, teardownGuard } from './helpers/product-owner-guard'

vi.mock('next/headers', async () => (await import('./helpers/product-owner-guard')).nextHeadersMock())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

let guard: Guard
let product = 0

const ADMIN_ONLY = {
  autoAccept: true,
  autoAcceptMaxSendBack: 90,
  incidentIntake: true,
  incidentSecret: 'attacker-chosen',
  requiredChecks: 'nothing',
  deployChecks: 'nothing',
  deployWaitMinutes: 1,
  riskAreas: ['x'],
  pathSets: { x: ['a/**'] },
  executor: 'runner',
  releaseMode: 'direct',
  autoClose: false,
  stagingUrl: 'https://attacker.example',
  state: 'active',
}

const patch = async (cookie: string, data: Record<string, unknown>) => {
  const { PATCH } = await import('../src/app/(payload)/api/[...slug]/route')
  return PATCH(
    new Request(`http://localhost/api/products/${product}`, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json', origin: 'http://localhost' },
      body: JSON.stringify(data),
    }),
    { params: Promise.resolve({ slug: ['products', String(product)] }) },
  )
}

const stored = async () => {
  const sql = (await import('@payloadcms/db-postgres')).sql
  const { rows } = await guard.payload.db.drizzle.execute(
    sql`SELECT "auto_accept", "auto_accept_max_send_back", "incident_intake", "incident_secret", "required_checks",
      "executor", "release_mode", "auto_close", "staging_url", "state" FROM "products" WHERE "id" = ${product}`,
  )
  return rows[0]
}

beforeAll(async () => {
  guard = await setupGuard('product_admin_fields')
  const found = await guard.payload.find({ collection: 'products', where: { slug: { equals: 'a1' } }, ...o })
  product = Number(found.docs[0]?.id)
}, 120_000)

afterAll(async () => {
  await teardownGuard(guard)
})

describe('PATCH /api/products/:id', () => {
  it('ignores every Admin-only setting from a non-admin Bauherr', async () => {
    const before = await stored()
    await patch(guard.bauherrCookie, { ...ADMIN_ONLY, name: 'renamed' })
    expect(await stored()).toEqual(before)
  })

  it('does not let a non-admin Bauherr move a Product to another Workspace', async () => {
    const other = await guard.payload.find({ collection: 'workspaces', where: { slug: { equals: 'b' } }, ...o })
    await patch(guard.bauherrCookie, { workspace: other.docs[0]?.id })
    const { sql } = await import('@payloadcms/db-postgres')
    const query = sql`SELECT "workspace_id" FROM "products" WHERE "id" = ${product}`
    const { rows } = await guard.payload.db.drizzle.execute(query)
    expect(Number(rows[0]?.workspace_id)).not.toBe(other.docs[0]?.id)
  })

  it('lets an Admin change them', async () => {
    const { signSession } = await import('../src/lib/oidc-session')
    const admin = (await guard.payload.find({ collection: 'bauherren', where: { role: { equals: 'admin' } }, ...o }))
      .docs[0]
    const res = await patch(`bauherr-session=${signSession(Number(admin?.id), 0)}`, {
      autoAccept: true,
      incidentIntake: true,
    })
    expect(res.status).toBe(200)
    expect(await stored()).toMatchObject({ auto_accept: true, incident_intake: true })
  })
})
