import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { scheduledTasks } from '../../src/jobs'
import { appendEvent } from '../../src/core/record/store'
import { upsertChecks } from '../../src/core/mirror/store'
import { ticket } from '../../src/core/views/ticket'
import { openCoreDb, type CoreDb } from './db'
import { mirrorSource } from './scenario'

const spy = vi.hoisted((): { calls: number; workspace: number; payload: unknown } => ({
  calls: 0, workspace: 0, payload: null,
}))

vi.mock('../../src/app/(app)/lib/session', () => ({
  getPerson: async () => ({ role: 'bauherr' }),
  currentWorkspace: async () => ({ user: null, workspace: { id: spy.workspace }, workspaces: [] }),
  payloadClient: async () => spy.payload,
}))
vi.mock('../../src/core/forge/reader', () => ({
  readerFor: () => {
    spy.calls++
    throw new Error('the forge must not be read')
  },
}))

let db: CoreDb
let recordId: number
let item: number

const version = async () => {
  const { GET } = await import('../../src/app/api/changes/route')
  return z.object({ v: z.number() }).parse(await (await GET()).json()).v
}

beforeAll(async () => {
  db = await openCoreDb('checks_live')
  spy.payload = db.payload
  spy.workspace = db.workspace
  recordId = await db.fresh()
  item = await (await mirrorSource({ db })).item(1, { kind: 'pr', head: 'h1' })
  const data = { runId: '1', patchId: 'p1', headSha: 'h1', pr: 1 }
  await appendEvent(db.payload, recordId, { type: 'build.submitted', data, actor: 'agent' })
}, 120_000)
afterAll(async () => {
  await db?.drop()
})

describe('checks on a ticket waiting for CI', () => {
  it('syncs pull requests every minute, so a finished check shows within a minute', () => {
    expect(scheduledTasks().find((task) => task.slug === 'sync-mirror')?.cron).toBe('0 * * * * *')
  })

  it('raises the poll version when a check changes', async () => {
    const before = await version()
    await upsertChecks(db.payload, db.workspace, item, [
      { sha: 'h1', name: 'ci', status: 'in_progress', conclusion: null, url: null, forgeUpdatedAt: null },
    ])
    const running = await version()
    expect(running).toBeGreaterThan(before)
    await upsertChecks(db.payload, db.workspace, item, [
      { sha: 'h1', name: 'ci', status: 'completed', conclusion: 'success', url: null, forgeUpdatedAt: null },
    ])
    expect(await version()).toBeGreaterThan(running)
  })

  it('reads the database only: no forge call while rendering the ticket and polling', async () => {
    const view = await ticket(db.payload, { workspace: db.workspace, recordId })
    await version()
    expect(view.pullRequest?.checks.map((c) => c.name)).toEqual(['ci'])
    expect(view.verifySince).toMatch(/^\d{4}-\d\d-\d\dT/)
    expect(spy.calls).toBe(0)
  })
})
