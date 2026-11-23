import { createHash } from 'node:crypto'
import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { IMAGE_MAX_BYTES } from '../src/core/attachments/image'
import { IMAGES, PNG, TEXT } from './core/images'
import { openMcp, type Mcp } from './core/mcp-harness'

type State = { person: { role: string } | null; workspaces: { id: number }[]; payload: unknown }
const state = vi.hoisted((): State => ({ person: null, workspaces: [], payload: null }))

vi.mock('../src/app/(app)/lib/session', () => ({
  getPerson: async () => state.person,
  workspacesOf: async () => state.workspaces,
  payloadClient: async () => state.payload,
}))

let m: Mcp
beforeAll(async () => {
  m = await openMcp('attachments_routes')
  state.payload = m.e.db.payload
  m.e.clock.now = new Date()
}, 120_000)
afterAll(async () => {
  await m?.e.drop()
})

const rows = async (query: ReturnType<typeof sql>) => (await m.e.db.payload.db.drizzle.execute(query)).rows
const reason = z.object({ error: z.string() })

const buildRun = async () => {
  await m.e.drain()
  await m.begin()
  const intake = await m.claimed(m.alpha)
  const accept = { runId: intake.runId, leaseToken: intake.leaseToken, result: { verdict: 'accept' } }
  await m.call('submit', accept, m.agent(m.alpha))
  const brief = await m.claimed(m.alpha)
  const done = { runId: brief.runId, leaseToken: brief.leaseToken, result: { goal: 'g', open: false } }
  await m.call('submit', done, m.agent(m.alpha))
  const build = await m.claimed(m.alpha)
  return { runId: build.runId, leaseToken: build.leaseToken }
}

const addressFor = async (ids: { runId: number; leaseToken: string }, extra: Record<string, unknown> = {}) => {
  const upload = { contentType: 'image/png', caption: 'List' }
  const input = { ...ids, criterion: 'c1', kind: 'screenshot', sha: 'abc', upload, ...extra }
  const out = z.object({ uploadUrl: z.string() }).parse(await m.call('attach_proof', input, m.agent(m.alpha)))
  return out.uploadUrl.slice(out.uploadUrl.lastIndexOf('/') + 1)
}

const put = async (token: string, body: BodyInit | null, headers: Record<string, string> = {}) => {
  const { PUT } = await import('../src/app/api/attachments/upload/[token]/route')
  const url = `http://factory.test/api/attachments/upload/${token}`
  return PUT(new Request(url, { method: 'PUT', body, headers }), { params: Promise.resolve({ token }) })
}

const get = async (id: number) => {
  const { GET } = await import('../src/app/api/attachments/[id]/route')
  return GET(new Request(`http://factory.test/api/attachments/${id}`), { params: Promise.resolve({ id: String(id) }) })
}

describe('PUT /api/attachments/upload/[token]', () => {
  it.each(IMAGES)('stores a $type image and writes the proof row of a screenshot', async ({ type, bytes }) => {
    const ids = await buildRun()
    const token = await addressFor(ids, { upload: { contentType: type, caption: 'List' } })
    const res = await put(token, bytes, { 'content-type': type })
    expect(res.status).toBe(201)
    const answer = z.object({ attachmentId: z.number(), proofId: z.number() }).parse(await res.json())
    const id = answer.attachmentId
    const [stored] = await rows(sql`
      SELECT "content_type", "byte_size", "sha256", "kind", "run_id" FROM "attachments" WHERE "id" = ${id}`)
    expect(stored).toMatchObject({ content_type: type, kind: 'screenshot', run_id: ids.runId })
    expect(Number(stored?.byte_size)).toBe(bytes.length)
    const proofs = await rows(sql`
      SELECT "criterion", "kind", "source", "sha", "body", "url" FROM "proofs" WHERE "attachment_id" = ${id}`)
    expect(proofs).toEqual([
      { criterion: 'c1', kind: 'screenshot', source: 'session', sha: 'abc', body: null, url: null },
    ])
    expect(await rows(sql`SELECT "id" FROM "proofs" WHERE "attachment_id" = ${id}`)).toEqual([{ id: answer.proofId }])
  })

  it('refuses bytes that are no image, whatever the declared type', async () => {
    const ids = await buildRun()
    const token = await addressFor(ids)
    const svg = await put(token, TEXT, { 'content-type': 'image/png' })
    expect(svg.status).toBe(415)
    expect(reason.parse(await svg.json()).error).toMatch(/PNG, JPEG or WebP/)
    const jpeg = await put(token, IMAGES[1].bytes, { 'content-type': 'image/png' })
    expect(jpeg.status).toBe(415)
    expect((await put(token, null)).status).toBe(400)
    const filled = await rows(sql`SELECT 1 FROM "attachments" WHERE "content" IS NOT NULL AND "run_id" = ${ids.runId}`)
    expect(filled).toHaveLength(0)
  })

  it('refuses an oversize body, by header and by count, and stores nothing', async () => {
    const ids = await buildRun()
    const token = await addressFor(ids)
    const big = Buffer.concat([PNG, Buffer.alloc(IMAGE_MAX_BYTES)])
    expect((await put(token, big)).status).toBe(413)
    expect((await put(token, PNG, { 'content-length': String(IMAGE_MAX_BYTES + 1) })).status).toBe(413)
    expect((await put(token, Buffer.concat([PNG, Buffer.alloc(IMAGE_MAX_BYTES - PNG.length)]))).status).toBe(201)
  })

  it('refuses an unknown, malformed, used and expired token', async () => {
    const ids = await buildRun()
    expect((await put('0'.repeat(64), PNG)).status).toBe(404)
    expect((await put('short', PNG)).status).toBe(404)
    const used = await addressFor(ids)
    expect((await put(used, PNG)).status).toBe(201)
    const again = await put(used, PNG)
    expect(again.status).toBe(409)
    expect(reason.parse(await again.json()).error).toMatch(/already used/)
    const old = await addressFor(ids)
    await rows(sql`UPDATE "attachments" SET "expires_at" = now() - interval '1 minute' WHERE "content" IS NULL`)
    const expired = await put(old, PNG)
    expect(expired.status).toBe(410)
    expect(reason.parse(await expired.json()).error).toMatch(/expired/)
  })

  it('refuses once the run no longer holds its lease', async () => {
    const ids = await buildRun()
    const token = await addressFor(ids)
    await m.call('release', ids, m.agent(m.alpha))
    const res = await put(token, PNG)
    expect(res.status).toBe(409)
    expect(reason.parse(await res.json()).error).toMatch(/lease/)
  })

  it('refuses an upload past the six images of a run', async () => {
    const ids = await buildRun()
    const tokens = []
    for (let i = 0; i < 6; i++) tokens.push(await addressFor(ids))
    for (const token of tokens) expect((await put(token, PNG)).status).toBe(201)
    const late = 'f'.repeat(64)
    await rows(sql`
      INSERT INTO "attachments" ("workspace_id", "record_id", "run_id", "stage", "kind", "caption", "content_type",
        "token_hash", "lease_hash", "expires_at", "updated_at", "created_at")
      SELECT "workspace_id", "record_id", "run_id", "stage", 'mockup', 'x', 'image/png',
        ${createHash('sha256').update(late).digest('hex')}, "lease_hash", now() + interval '5 minutes', now(), now()
      FROM "attachments" WHERE "run_id" = ${ids.runId} LIMIT 1`)
    const res = await put(late, PNG)
    expect(res.status).toBe(409)
    expect(reason.parse(await res.json()).error).toMatch(/already has 6 images/)
  })
})

describe('GET /api/attachments/[id]', () => {
  const stored = async () => {
    const ids = await buildRun()
    const res = await put(await addressFor(ids), PNG)
    return z.object({ attachmentId: z.number() }).parse(await res.json()).attachmentId
  }

  it('serves the bytes to a person of the Workspace with the hardened headers', async () => {
    const id = await stored()
    state.person = { role: 'bauherr' }
    state.workspaces = [{ id: m.e.db.workspace }]
    const res = await get(id)
    expect(res.status).toBe(200)
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-disposition')).toBe('inline')
    expect(res.headers.get('cache-control')).toBe('private, max-age=3600')
  })

  it('answers 404 to a person of another Workspace, a Product owner, a visitor and a pending upload', async () => {
    const id = await stored()
    state.person = { role: 'bauherr' }
    state.workspaces = [{ id: m.e.db.otherWorkspace }]
    expect((await get(id)).status).toBe(404)
    state.workspaces = [{ id: m.e.db.workspace }]
    state.person = { role: 'product-owner' }
    expect((await get(id)).status).toBe(404)
    state.person = null
    expect((await get(id)).status).toBe(404)
    state.person = { role: 'bauherr' }
    const pending = await addressFor(await buildRun())
    const [row] = await rows(sql`SELECT "id" FROM "attachments" WHERE "content" IS NULL ORDER BY "id" DESC LIMIT 1`)
    expect(pending).toBeTruthy()
    expect((await get(Number(row?.id))).status).toBe(404)
    expect((await get(0)).status).toBe(404)
  })
})
