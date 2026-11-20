import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { agentSessions, IDLE_WINDOW_MS } from '../../src/core/views/sessions'
import { openMcp, type Mcp } from './mcp-harness'

let m: Mcp
beforeAll(async () => {
  m = await openMcp('core_sessions_view')
}, 120_000)
afterAll(async () => {
  await m?.e.drop()
})

const connect = async (member: typeof m.alpha, role: string, label?: string) =>
  z
    .object({ session: z.string() })
    .parse(await m.call('connect', { role, label }, m.agent(member)))
    .session

const list = (owner: number, workspace = m.e.db.workspace, now = m.e.clock.now) =>
  agentSessions(m.e.db.payload, { workspace, owner, now })

describe('agentSessions', () => {
  it('lists idle, silent, closed and working sessions, newest first', async () => {
    const drizzle = m.e.db.payload.db.drizzle
    await connect(m.alpha, 'reviewer', 'laptop')
    const closing = await connect(m.alpha, 'verifier')
    await drizzle.execute(sql`UPDATE "agent_sessions" SET "disconnected_at" = now() WHERE "public_id" = ${closing}`)
    await m.begin()
    const claimed = await m.claimed(m.alpha, 'builder')
    const expected = z.object({ source_number: z.coerce.number() }).parse(
      (await drizzle.execute(sql`
        SELECT r."source_number" FROM "stage_runs" s JOIN "records" r ON r."id" = s."record_id"
        WHERE s."id" = ${claimed.runId}`)).rows[0],
    )

    const rows = await list(m.alpha.id)
    expect(rows.map((row) => [row.role, row.state])).toEqual([
      ['builder', 'working'],
      ['verifier', 'closed'],
      ['reviewer', 'idle'],
    ])
    expect(rows[0]?.ticket?.number).toBe(expected.source_number)
    expect(rows[2]).toMatchObject({ label: 'laptop', keyLabel: 'agent', ticket: null })

    const later = new Date(m.e.clock.now.getTime() + IDLE_WINDOW_MS + 1000)
    const silent = await list(m.alpha.id, m.e.db.workspace, later)
    expect(silent.find((row) => row.role === 'reviewer')?.state).toBe('silent')
    await m.e.drain()
  })

  it('does not list the sessions of another person or another Workspace', async () => {
    await connect(m.beta, 'builder')
    const alphaRows = await list(m.alpha.id)
    expect(alphaRows.every((row) => row.keyLabel === 'agent')).toBe(true)
    expect(await list(m.beta.id)).toHaveLength(0)
    expect(await list(m.alpha.id, m.e.db.otherWorkspace)).toHaveLength(0)
    expect(await list(m.beta.id, m.e.db.otherWorkspace)).toHaveLength(1)
  })
})
