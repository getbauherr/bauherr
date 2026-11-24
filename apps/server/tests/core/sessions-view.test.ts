import { sql } from '@payloadcms/db-postgres'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { SessionsTable } from '../../src/app/(app)/components/connect/SessionsTable'
import { agentSessions, IDLE_WINDOW_MS } from '../../src/core/views/sessions'
import { openMcp, type Mcp } from './mcp-harness'

vi.mock('../../src/app/(app)/components/TicketRef', () => ({
  TicketRef: ({ recordId, number }: { recordId: number; number: number }) =>
    createElement('a', { href: `/tickets/${recordId}` }, `#${number}`),
}))

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
    .parse(await m.call('connect', { role, label, clientSession: 'test-session-1' }, m.agent(member)))
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
    expect(rows[0]?.tickets.map((t) => t.number)).toEqual([expected.source_number])
    expect(rows[2]).toMatchObject({ label: 'laptop', keyLabel: 'agent', tickets: [] })

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

describe('a session with several runs', () => {
  it('lists every live run with its capacity and renders the slots', async () => {
    await m.e.drain()
    const { session } = z
      .object({ session: z.string() })
      .parse(
        await m.call(
          'connect',
          { role: 'builder', label: 'multi', capacity: 3, clientSession: 'test-session-1' },
          m.agent(m.alpha),
        ),
      )
    await m.begin()
    await m.begin()
    await m.call('next_work', { session }, m.agent(m.alpha))
    await m.call('next_work', { session }, m.agent(m.alpha))
    const row = (await list(m.alpha.id)).find((r) => r.label === 'multi')
    expect(row).toMatchObject({ capacity: 3, state: 'working' })
    expect(row?.tickets).toHaveLength(2)
    const html = renderToStaticMarkup(createElement(SessionsTable, { sessions: row ? [row] : [] }))
    expect(html).toContain('2 of 3 working')
    for (const ticket of row?.tickets ?? []) expect(html).toContain(`/tickets/${ticket.recordId}`)
    await m.e.drain()
  })
})
