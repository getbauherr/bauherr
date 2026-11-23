import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runPage } from '../../src/core/views/run'
import { openViews, seed, type Seeded } from './views-harness'

let s: Seeded
const MIN = 60_000
const run = (query: ReturnType<typeof sql>) => s.e.db.payload.db.drizzle.execute(query)
const session = (role: string, lastSeen: Date) =>
  run(sql`INSERT INTO "agent_sessions" ("workspace_id", "public_id", "role", "connected_at", "last_seen_at")
    VALUES (${s.e.db.workspace}, ${`s-${Math.random()}`}, ${role}, now(), ${lastSeen.toISOString()}::timestamptz)`)

beforeAll(async () => {
  s = await seed(await openViews('core_views_run_page'))
}, 240_000)
afterAll(async () => {
  await s?.e.drop()
})

const view = async (recordId: number) => {
  const found = await run(
    sql`SELECT "id" FROM "stage_runs" WHERE "record_id" = ${recordId} ORDER BY "id" DESC LIMIT 1`,
  )
  const runId = Number(found.rows[0]?.id)
  return runPage(s.e.db.payload, { workspace: s.e.db.workspace, runId, withCost: false })
}

describe('runPage health, session and pull request', () => {
  it('calls a claimed run stuck after 10 minutes without a heartbeat, and only then', async () => {
    const id = s.names.verifying
    await run(sql`UPDATE "stage_runs" SET "status" = 'claimed' WHERE "record_id" = ${id} AND "status" = 'queued'`)
    expect((await view(id)).health.word).toBe('Working')
    await run(sql`UPDATE "stage_runs" SET "updated_at" = now() - interval '11 minutes' WHERE "record_id" = ${id}`)
    expect((await view(id)).health).toMatchObject({ word: 'Stuck', action: null })
    await run(sql`UPDATE "stage_runs" SET "status" = 'queued', "updated_at" = now()
      WHERE "record_id" = ${id} AND "status" = 'claimed'`)
  })

  it('offers to connect an agent for a queued run until a live session of the role exists', async () => {
    expect((await view(s.names.verifying)).health).toMatchObject({ word: 'Waiting for a session', action: 'connect' })
    await session('verifier', new Date(Date.now() - 11 * MIN))
    expect((await view(s.names.verifying)).health.action).toBe('connect')
    await session('verifier', new Date())
    expect((await view(s.names.verifying)).health).toMatchObject({ word: 'Working', action: null })
  })

  it('links the pull request on its forge only when the ticket has one', async () => {
    expect((await view(s.names.briefCard)).pullRequest).toBeNull()
    await s.item(1, { kind: 'pr', head: 'h1' })
    const pull = (await view(s.names.verifying)).pullRequest
    expect(pull).toMatchObject({ number: 1, forge: 'github' })
    expect(pull?.url).toMatch(/^https:\/\//)
  })

  it('hands the cost to an Admin only', async () => {
    const id = s.names.verifying
    const runId = Number((await run(sql`SELECT "id" FROM "stage_runs" WHERE "record_id" = ${id} LIMIT 1`)).rows[0]?.id)
    const base = { workspace: s.e.db.workspace, runId }
    expect((await runPage(s.e.db.payload, { ...base, withCost: false })).costUsd).toBeNull()
    expect((await runPage(s.e.db.payload, { ...base, withCost: true })).costUsd).not.toBeUndefined()
  })
})
