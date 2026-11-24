import { claim, heartbeat } from '../../src/core/run/leases'
import { finishRun } from '../../src/core/run/store'
import { patchRecord, readRecord, setRank } from '../../src/core/record/store'
import type { Engine } from './harness'
import { toBrief } from './scenario'

export const claimed = async (e: Engine, id: number) => {
  await setRank(e.db.payload, id, -1000)
  const input = { workspace: e.db.workspace, role: 'builder', by: 'runner-seed', now: e.clock.now } as const
  const got = await claim(e.db.payload, input)
  await setRank(e.db.payload, id, 0)
  if (!got) throw new Error('no run queued')
  return got
}

const LONG = `${'unbroken'.repeat(25)}x`

export const failedBuild = async (e: Engine, id: number) => {
  const { run, token } = await claimed(e, id)
  await heartbeat(e.db.payload, run.id, token, { now: new Date(), step: LONG })
  await finishRun(e.db.payload, run.id, { status: 'failed', error: 'The build agent stopped.', now: new Date() })
  const { version } = await readRecord(e.db.payload, id)
  const by = { stage: 'build' as const, runId: 'seed' }
  await patchRecord(e.db.payload, id, { expectedVersion: version, writes: ['handoff'], patch: { handoff: LONG }, by })
}


export const runTickets = async (e: Engine) => {
  const runQueued = await toBrief(e, false)
  const runFailed = await toBrief(e, false)
  await failedBuild(e, runFailed)
  const runQuiet = await toBrief(e, false)
  await claimed(e, runQuiet)
  return { runQueued, runFailed, runQuiet }
}
