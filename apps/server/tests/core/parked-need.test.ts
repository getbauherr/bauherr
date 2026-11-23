import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { decide } from '../../src/core/decide'
import { advance } from '../../src/core/engine'
import { readRecord } from '../../src/core/record/store'
import { claim } from '../../src/core/run/leases'
import { releaseRun } from '../../src/core/submit'
import { board } from '../../src/core/views/board'
import { holds } from '../../src/core/views/holds'
import { isStuck } from '../../src/core/views/status'
import { ticket } from '../../src/core/views/ticket'
import { openEngine, type Engine } from './harness'

let e: Engine
beforeAll(async () => {
  e = await openEngine('core_parked_need')
}, 120_000)
afterAll(async () => {
  await e?.drop()
})

beforeEach(async () => {
  await e.drain()
})

const NEED = 'AWS Connection'

const parked = async () => {
  const id = await e.db.fresh()
  await advance(id, e.deps())
  await e.work(id, 'builder', { verdict: 'accept' })
  await e.work(id, 'builder', { goal: 'Fix it', open: false })
  const claimed = await claim(e.db.payload, { workspace: e.db.workspace, role: 'builder', by: 'x', now: e.clock.now })
  if (!claimed) throw new Error('no run queued')
  await releaseRun(claimed.run.id, claimed.token, e.deps(), NEED)
  return id
}
const runs = async (id: number, status: string) =>
  (await e.db.payload.db.drizzle.execute(sql`SELECT "stage" FROM "stage_runs"
    WHERE "record_id" = ${id} AND "status" = ${status} ORDER BY "id"`)).rows.map((r) => r.stage)
const options = ['resume', 'discard']

describe('a ticket parked on a missing owner prerequisite', () => {
  it('waits on the owner naming the need and queues no run', async () => {
    const id = await parked()
    expect(await e.view(id)).toMatchObject({
      stage: 'build',
      waitingOn: 'owner',
      card: { card: 'question', reason: 'parked', options, text: NEED },
    })
    expect(await runs(id, 'queued')).toEqual([])
  })

  it('offers Resume and Discard, is not stuck and is not a stuck hold', async () => {
    const id = await parked()
    const { card } = await readRecord(e.db.payload, id)
    expect(card?.options).toEqual(options)
    expect(isStuck(card)).toBe(false)
    const all = await holds(e.db.payload, { workspace: e.db.workspace, now: new Date() })
    const stuck = all.flatMap((h) => (h.kind === 'tickets-stuck' ? h.tickets.map((t) => t.recordId) : []))
    expect(stuck).not.toContain(id)
  })

  it('shows Parked with the need and the stage on the board and the ticket', async () => {
    const id = await parked()
    const cards = Object.values((await board(e.db.payload, { workspace: e.db.workspace, now: new Date() })).stages)
    const card = cards.flat().find((c) => c.recordId === id)
    expect(card).toMatchObject({ status: 'parked-on-need', state: 'owner', detail: `Parked: ${NEED} (build)` })
    expect(await ticket(e.db.payload, { workspace: e.db.workspace, recordId: id })).toMatchObject({
      status: 'parked-on-need',
      stage: 'build',
    })
  })

  it('resumes the same stage with a new run', async () => {
    const id = await parked()
    const seq = await e.seq(id)
    await decide(id, e.owner, { ask: 'question:parked', choice: 'resume', seq }, e.deps())
    expect(await e.view(id)).toMatchObject({ stage: 'build', waitingOn: 'agents', card: null })
    expect(await runs(id, 'queued')).toEqual(['build'])
  })

  it('closes the ticket as discarded on Discard', async () => {
    const id = await parked()
    const seq = await e.seq(id)
    await decide(id, e.owner, { ask: 'question:parked', choice: 'discard', seq }, e.deps())
    expect((await e.view(id)).types).toContain('ticket.closed')
    expect(await runs(id, 'queued')).toEqual([])
  })
})
