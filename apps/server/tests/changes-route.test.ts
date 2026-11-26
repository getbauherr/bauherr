import { sql } from '@payloadcms/db-postgres'
import { z } from 'zod'
import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createRecord } from '../src/core/record/store'
import { openCoreDb, type CoreDb } from './core/db'
import { source } from './core/fixtures'

type State = { person: { role: string } | null; workspace: number; payload: unknown }
const state = vi.hoisted((): State => ({ person: null, workspace: 0, payload: null }))

vi.mock('../src/app/(app)/lib/session', () => ({
  getPerson: async () => state.person,
  currentWorkspace: async () => ({ user: state.person, workspace: { id: state.workspace }, workspaces: [] }),
  payloadClient: async () => state.payload,
}))

let db: CoreDb
const read = async (tables?: string) => {
  const { GET } = await import('../src/app/api/changes/route')
  const res = await GET(new Request(`http://localhost/api/changes${tables === undefined ? '' : `?tables=${tables}`}`))
  return { status: res.status, body: z.object({ v: z.number().optional() }).parse(await res.json()) }
}
const touch = (payload: Payload, id: number) =>
  payload.db.drizzle.execute(sql`UPDATE "records" SET "updated_at" = now() + interval '1 hour' WHERE "id" = ${id}`)

beforeAll(async () => {
  db = await openCoreDb('changes_route')
  state.payload = db.payload
  state.workspace = db.workspace
}, 120_000)
afterAll(async () => {
  await db?.drop()
})

describe('GET /api/changes', () => {
  it('refuses a visitor and a Product owner', async () => {
    state.person = null
    expect((await read()).status).toBe(401)
    state.person = { role: 'product-owner' }
    expect((await read()).status).toBe(401)
  })

  it('answers a Bauherr with the newest change of their Workspace only', async () => {
    state.person = { role: 'bauherr' }
    expect(await read()).toEqual({ status: 200, body: { v: 0 } })
    const mine = await db.fresh()
    const first = (await read()).body.v ?? 0
    expect(first).toBeGreaterThan(0)
    await createRecord(db.payload, {
      workspace: db.otherWorkspace, product: db.product, source: { ...source, number: 5 }, type: 'bug',
    })
    expect((await read()).body.v).toBe(first)
    await touch(db.payload, mine)
    expect((await read()).body.v ?? 0).toBeGreaterThan(first)
  })

  it('stamps only the requested tables and refuses an unknown one', async () => {
    state.person = { role: 'bauherr' }
    await db.fresh()
    expect((await read('records,events')).body.v).toBeGreaterThan(0)
    expect((await read('agent_sessions')).body.v).toBe(0)
    expect((await read('records;DROP')).status).toBe(400)
  })

  it('answers an Admin too', async () => {
    state.person = { role: 'admin' }
    expect((await read()).status).toBe(200)
  })
})
