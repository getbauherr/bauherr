import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createRecord } from '../src/core/record/store'
import { source } from './core/fixtures'
import { PNG } from './core/images'
import {
  APP,
  type Guard,
  nextHeadersMock,
  notFound,
  o,
  pageModules,
  routeModules,
  session,
  setupGuard,
  teardownGuard,
} from './helpers/product-owner-guard'

vi.mock('next/headers', async () => nextHeadersMock())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

let guard: Guard
let own: number
let foreign: number

const product = async (slug: string) =>
  Number((await guard.payload.find({ collection: 'products', where: { slug: { equals: slug } }, ...o })).docs[0]?.id)

const record = async (slug: string, number: number) => {
  const workspace = Number(
    (await guard.payload.find({ collection: 'workspaces', where: { slug: { equals: 'a' } }, ...o })).docs[0]?.id,
  )
  const input = { workspace, product: await product(slug), source: { ...source, number }, type: 'change' as const }
  return (await createRecord(guard.payload, input)).id
}

beforeAll(async () => {
  guard = await setupGuard('request_page_guard')
  own = await record('a1', 501)
  foreign = await record('a2', 502)
}, 120_000)

afterAll(async () => {
  await teardownGuard(guard)
})

const outcome = async (id: number): Promise<string> => {
  const page = await pageModules[`${APP}(app)/(shell)/requests/[id]/page.tsx`]()
  try {
    await page.default({ params: Promise.resolve({ id: String(id) }) })
    return 'rendered'
  } catch (error) {
    return notFound(error) ? '404' : `threw ${String(error)}`
  }
}

const attach = async (recordId: number): Promise<number> => {
  const run = await guard.payload.db.drizzle.execute(sql`
    INSERT INTO "stage_runs" ("workspace_id", "record_id", "stage", "role", "status", "fingerprint", "steps")
    SELECT "workspace_id", "id", 'brief', 'builder', 'submitted', 'f', '[]'::jsonb FROM "records"
    WHERE "id" = ${recordId} RETURNING "id"`)
  const runId = Number((run.rows[0] as { id: number }).id)
  const found = await guard.payload.db.drizzle.execute(sql`
    INSERT INTO "attachments" ("workspace_id", "record_id", "run_id", "stage", "kind", "caption", "content_type",
      "byte_size", "sha256", "content", "token_hash", "lease_hash", "expires_at", "updated_at", "created_at")
    SELECT "workspace_id", "id", ${runId}, 'brief', 'mockup', 'Screen', 'image/png', ${PNG.length}, ${`s${recordId}`},
      ${PNG.toString('base64')}, ${`t${recordId}`}, 'x', now(), now(), now()
    FROM "records" WHERE "id" = ${recordId} RETURNING "id"`)
  return Number((found.rows[0] as { id: number }).id)
}

const picture = async (id: number): Promise<number> => {
  const route = await routeModules[`${APP}api/attachments/[id]/route.ts`]()
  const get = route.GET as (r: Request, c: unknown) => Promise<Response>
  const request = new Request('http://t/api/attachments/1', { headers: { cookie: session.cookie } })
  return (await get(request, { params: Promise.resolve({ id: String(id) }) })).status
}

describe('the request page for a Product owner', () => {
  it('opens a request of an assigned Product', async () => {
    session.cookie = guard.productOwnerCookie
    expect(await outcome(own)).toBe('rendered')
  })

  it('answers a request of another Product with a 404', async () => {
    session.cookie = guard.productOwnerCookie
    expect(await outcome(foreign)).toBe('404')
  })

  it('answers a request that does not exist with a 404', async () => {
    session.cookie = guard.productOwnerCookie
    expect(await outcome(99_999_999)).toBe('404')
  })

  it('opens both for a Bauherr of the Workspace', async () => {
    session.cookie = guard.bauherrCookie
    expect([await outcome(own), await outcome(foreign)]).toEqual(['rendered', 'rendered'])
  })

  it('serves the pictures of an assigned Product, and 404 for those of another', async () => {
    const ownPicture = await attach(own)
    const foreignPicture = await attach(foreign)
    session.cookie = guard.productOwnerCookie
    expect([await picture(ownPicture), await picture(foreignPicture)]).toEqual([200, 404])
  })

  it('serves no picture to a Product owner for an attachment that is not there', async () => {
    session.cookie = guard.productOwnerCookie
    expect(await picture(99_999_999)).toBe(404)
  })
})
