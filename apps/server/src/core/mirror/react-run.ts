import { inLockedRecord, type Conn } from '../conn'
import { advance, type AdvanceDeps } from '../engine'
import type { AppEvent } from '../events'
import { fold, foldOptions, type Config, type State } from '../lifecycle'
import { appendEvent, readEvents, readRecord } from '../record/store'
import { releaseLive } from '../run/leases'
import { react } from './react'
import { loadReactInput, openRecords, recordsOfItems } from './react-store'

const actorOf = (event: AppEvent) => (event.type === 'reporter.replied' ? 'reporter' : 'factory')

const releaseStaleVerify = async (tx: Conn, recordId: number, state: State, now: Date): Promise<void> => {
  for (const run of await releaseLive(tx, recordId, now, 'verify')) {
    if (state.run?.runId !== String(run.id)) continue
    await appendEvent(tx, recordId, {
      type: 'run.released',
      data: { stage: run.stage, runId: String(run.id) },
      actor: 'factory',
    })
  }
}

const reactLocked = async (deps: AdvanceDeps, recordId: number, config: Config): Promise<number> =>
  inLockedRecord(deps.payload, recordId, async (tx) => {
    const stored = await readRecord(tx, recordId)
    const events = await readEvents(tx, recordId)
    const state = fold(events, foldOptions(config))
    if (state.closed !== null || state.stage === 'done') return 0
    const input = await loadReactInput(tx, stored, state, events, config, deps.now)
    const derived = input ? react(input) : []
    for (const event of derived) await appendEvent(tx, recordId, { ...event, actor: actorOf(event) })
    if (derived.some((event) => event.type === 'pull.adopted')) await releaseStaleVerify(tx, recordId, state, deps.now)
    return derived.length
  })

export const reactToRecords = async (deps: AdvanceDeps, recordIds: number[]): Promise<void> => {
  for (const recordId of recordIds) {
    const appended = await reactLocked(deps, recordId, await deps.configFor(recordId))
    if (appended > 0) await advance(recordId, deps)
  }
}

export const reactToItems = async (deps: AdvanceDeps, items: number[]): Promise<void> =>
  reactToRecords(deps, await recordsOfItems({ db: deps.payload.db }, items))

export const reactToOpenRecords = async (deps: AdvanceDeps): Promise<void> =>
  reactToRecords(deps, await openRecords({ db: deps.payload.db }))
