import { afterAll, beforeAll, expect, it } from 'vitest'
import { advance } from '../../src/core/engine'
import { claim } from '../../src/core/run/leases'
import { readRun } from '../../src/core/run/store'
import { openEngine, type Engine } from './harness'

let e: Engine
beforeAll(async () => {
  e = await openEngine('core_expire_task')
}, 120_000)
afterAll(async () => {
  await e?.drop()
})

it('releases a run whose lease passed when the scheduled job runs', async () => {
  const id = await e.db.fresh()
  await advance(id, e.deps())
  const past = new Date(Date.now() - 2 * 60 * 60_000)
  const claimed = await claim(e.db.payload, { workspace: e.db.workspace, role: 'builder', by: 'gone', now: past })
  expect(claimed?.run.recordId).toBe(id)
  await e.db.payload.jobs.queue({ task: 'expire-runs', input: {} })
  await e.db.payload.jobs.run()
  expect((await readRun(e.db.payload, claimed?.run.id ?? 0)).status).toBe('released')
  const view = await e.view(id)
  expect(view.types.slice(-2)).toEqual(['run.released', 'run.started'])
  expect(view).toMatchObject({ stage: 'intake', waitingOn: 'agents' })
})
