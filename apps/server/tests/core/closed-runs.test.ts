import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { advance } from '../../src/core/engine'
import { appendEvent, readEvents, readRecord } from '../../src/core/record/store'
import { RecordClosed, RunNotClaimed } from '../../src/core/run/errors'
import { claim } from '../../src/core/run/leases'
import { readRun } from '../../src/core/run/store'
import { releaseRun, submit } from '../../src/core/submit'
import { openEngine, type Engine } from './harness'

let e: Engine
beforeAll(async () => {
  e = await openEngine('core_closed_runs')
}, 120_000)
afterAll(async () => {
  await e?.drop()
})
beforeEach(async () => {
  await e.drain()
})

const claimIntake = (by = 'agent') =>
  claim(e.db.payload, { workspace: e.db.workspace, role: 'builder', by, now: e.clock.now })

const close = (id: number) =>
  appendEvent(e.db.payload, id, { type: 'ticket.closed', data: { reason: 'discarded' }, actor: 'owner' })

const queuedRun = async () => {
  const id = await e.db.fresh()
  await advance(id, e.deps())
  return id
}

const runEvents = async (id: number) =>
  (await readEvents(e.db.payload, id)).filter((event) => event.type.startsWith('run.')).map((event) => event.type)

describe('a ticket that closes with a live run', () => {
  it('releases a queued run, ends it in the log once, and lets nobody claim it', async () => {
    const id = await queuedRun()
    await close(id)
    await advance(id, e.deps())
    await advance(id, e.deps())
    expect(await runEvents(id)).toEqual(['run.started', 'run.released'])
    expect(await claimIntake()).toBeNull()
    expect(await e.view(id)).toMatchObject({ waitingOn: 'nobody' })
  })

  it('releases a claimed run, and refuses its late submit with a distinct error', async () => {
    const id = await queuedRun()
    const claimed = await claimIntake()
    if (!claimed) throw new Error('no run')
    await close(id)
    await advance(id, e.deps())
    expect((await readRun(e.db.payload, claimed.run.id)).status).toBe('released')
    expect(await runEvents(id)).toEqual(['run.started', 'run.released'])
    const result = { verdict: 'accept' }
    await expect(submit(claimed.run.id, claimed.token, result, e.deps())).rejects.toThrow(RunNotClaimed)
  })

  it('does not end a run twice when the log already ended it', async () => {
    const id = await queuedRun()
    const claimed = await claimIntake()
    if (!claimed) throw new Error('no run')
    await releaseRun(claimed.run.id, claimed.token, { ...e.deps(), mayStart: undefined })
    await close(id)
    await advance(id, e.deps())
    const released = (await readEvents(e.db.payload, id)).filter((event) => event.type === 'run.released')
    const ids = released.map((event) => (event.type === 'run.released' ? event.data.runId : ''))
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })

  it('releases the live run of a record that reached done', async () => {
    const id = await queuedRun()
    await appendEvent(e.db.payload, id, { type: 'intake.closed', data: { reason: 'not-planned' }, actor: 'agent' })
    await advance(id, e.deps())
    expect((await runEvents(id)).filter((t) => t === 'run.released')).toHaveLength(1)
  })
})

describe('claim and submit as a second line of defence', () => {
  it('claim finds no run of a closed record even before the engine released it', async () => {
    const id = await queuedRun()
    await close(id)
    expect(await claimIntake()).toBeNull()
    expect((await readRecord(e.db.payload, id)).stage).toBe('intake')
  })

  it('submit on a run whose record closed in the meantime is refused and changes nothing', async () => {
    const id = await queuedRun()
    const claimed = await claimIntake()
    if (!claimed) throw new Error('no run')
    await close(id)
    const snapshot = async () => ({
      events: (await readEvents(e.db.payload, id)).length,
      version: (await readRecord(e.db.payload, id)).version,
    })
    const before = await snapshot()
    const result = { verdict: 'accept' }
    await expect(submit(claimed.run.id, claimed.token, result, e.deps())).rejects.toThrow(RecordClosed)
    expect(await snapshot()).toEqual(before)
    expect((await readRun(e.db.payload, claimed.run.id)).status).toBe('claimed')
  })
})
