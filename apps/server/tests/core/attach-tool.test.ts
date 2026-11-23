import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ProofRefused, RunNotClaimed, RunNotFound, WrongLeaseToken } from '../../src/core/run/errors'
import { RECORD_IMAGE_MAX, RUN_IMAGE_MAX } from '../../src/core/attachments/image'
import { openMcp, ORIGIN, type Mcp } from './mcp-harness'

let m: Mcp
beforeAll(async () => {
  m = await openMcp('core_attach_tool')
}, 120_000)
afterAll(async () => {
  await m?.e.drop()
})

const rows = async (query: ReturnType<typeof sql>) => (await m.e.db.payload.db.drizzle.execute(query)).rows
const address = z.object({ uploadUrl: z.string(), expiresAt: z.string() })
const upload = { contentType: 'image/png', caption: 'The new list' }

const briefRun = async () => {
  const record = await m.begin()
  const intake = await m.claimed(m.alpha)
  const accept = { runId: intake.runId, leaseToken: intake.leaseToken, result: { verdict: 'accept' } }
  await m.call('submit', accept, m.agent(m.alpha))
  const brief = await m.claimed(m.alpha)
  return { record, ids: { runId: brief.runId, leaseToken: brief.leaseToken } }
}

const buildRun = async () => {
  const { ids } = await briefRun()
  await m.call('submit', { ...ids, result: { goal: 'g', open: false } }, m.agent(m.alpha))
  const build = await m.claimed(m.alpha)
  return { runId: build.runId, leaseToken: build.leaseToken }
}

const call = (input: unknown, member = m.alpha) => m.call('attach_proof', input, m.agent(member))

describe('attach_proof forms', () => {
  it('stores text and a URL as before and answers an upload with a one-time address', async () => {
    await m.e.drain()
    const ids = await buildRun()
    const text = { ...ids, criterion: 'c1', kind: 'output', sha: 'abc' }
    expect(await call({ ...text, body: 'ok' })).toHaveProperty('proofId')
    expect(await call({ ...text, kind: 'link', url: 'https://ci.example/1' })).toHaveProperty('proofId')
    const out = address.parse(await call({ ...text, kind: 'screenshot', upload }))
    expect(out.uploadUrl).toMatch(new RegExp(`^${ORIGIN}/api/attachments/upload/[0-9a-f]{64}$`))
    expect(out.expiresAt).toBe(new Date(m.e.clock.now.getTime() + 10 * 60_000).toISOString())
    const stored = await rows(sql`
      SELECT "token_hash", "content", "kind" FROM "attachments" WHERE "run_id" = ${ids.runId}`)
    expect(stored).toHaveLength(1)
    expect(stored[0]?.kind).toBe('screenshot')
    expect(stored[0]?.content).toBeNull()
    expect(out.uploadUrl).not.toContain(String(stored[0]?.token_hash))
    expect(await rows(sql`SELECT 1 FROM "proofs" WHERE "attachment_id" IS NOT NULL`)).toHaveLength(0)
  })

  it('takes a mockup without a criterion and refuses one with a criterion or a sha', async () => {
    await m.e.drain()
    const { ids } = await briefRun()
    expect(address.parse(await call({ ...ids, kind: 'mockup', upload }))).toBeTruthy()
    for (const extra of [{ criterion: 'c1' }, { sha: 'abc' }]) {
      await expect(call({ ...ids, kind: 'mockup', upload, ...extra })).rejects.toThrow(z.ZodError)
    }
    await expect(call({ ...ids, kind: 'mockup', body: 'x' })).rejects.toThrow(z.ZodError)
  })

  it('keeps the criterion and the sha required for the other kinds', async () => {
    await m.e.drain()
    const ids = await buildRun()
    await expect(call({ ...ids, kind: 'screenshot', sha: 'abc', upload })).rejects.toThrow(ProofRefused)
    await expect(call({ ...ids, criterion: 'c1', kind: 'output', body: 'x' })).rejects.toThrow(ProofRefused)
    await expect(call({ ...ids, criterion: 'c9', kind: 'screenshot', sha: 'a', upload })).rejects.toThrow(ProofRefused)
    await expect(call({ ...ids, criterion: 'c1', kind: 'output', sha: 'a', upload })).rejects.toThrow(z.ZodError)
    await expect(call({ ...ids, criterion: 'c1', kind: 'screenshot', sha: 'a', body: 'x', upload })).rejects.toThrow(
      z.ZodError,
    )
    const svg = { ...upload, contentType: 'image/svg+xml' }
    await expect(call({ ...ids, criterion: 'c1', kind: 'screenshot', sha: 'a', upload: svg })).rejects.toThrow(
      z.ZodError,
    )
    await expect(
      call({ ...ids, criterion: 'c1', kind: 'screenshot', sha: 'a', upload: { ...upload, caption: 'x'.repeat(201) } }),
    ).rejects.toThrow(z.ZodError)
  })

  it('refuses outside an own live run', async () => {
    await m.e.drain()
    const { ids } = await briefRun()
    const input = { ...ids, kind: 'mockup', upload }
    await expect(call(input, m.beta)).rejects.toThrow(RunNotFound)
    await expect(call({ ...input, leaseToken: 'nope' })).rejects.toThrow(WrongLeaseToken)
    await m.call('release', ids, m.agent(m.alpha))
    await expect(call(input)).rejects.toThrow(RunNotClaimed)
  })

  it('refuses the seventh image of a run and the thirty-first of a record', async () => {
    await m.e.drain()
    const { record, ids } = await briefRun()
    for (let i = 0; i < RUN_IMAGE_MAX; i++) await call({ ...ids, kind: 'mockup', upload })
    await expect(call({ ...ids, kind: 'mockup', upload })).rejects.toThrow(/already has 6 images/)
    await rows(sql`DELETE FROM "attachments" WHERE "run_id" = ${ids.runId}`)
    await rows(sql`
      INSERT INTO "attachments" ("workspace_id", "record_id", "run_id", "stage", "kind", "caption", "content_type",
        "content", "token_hash", "lease_hash", "expires_at", "updated_at", "created_at")
      SELECT ${m.e.db.workspace}, ${record}, ${ids.runId}, 'brief', 'mockup', 'c', 'image/png', 'AA', 'h' || g, 'l',
        now(), now(), now() FROM generate_series(1, ${RECORD_IMAGE_MAX}) g`)
    await rows(sql`
      UPDATE "attachments" SET "run_id" = (SELECT min("id") FROM "stage_runs") WHERE "record_id" = ${record}`)
    await expect(call({ ...ids, kind: 'mockup', upload })).rejects.toThrow(/already has 30 images/)
  })
})
