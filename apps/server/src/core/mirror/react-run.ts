import { inLockedRecord, type Conn } from '../conn'
import { runEffects } from '../effects'
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

const STALES_VERIFY: AppEvent['type'][] = ['pull.adopted', 'pull.conflicted']

const reactLocked = async (deps: AdvanceDeps, recordId: number, config: Config): Promise<AppEvent[]> =>
  inLockedRecord(deps.payload, recordId, async (tx) => {
    const stored = await readRecord(tx, recordId)
    const events = await readEvents(tx, recordId)
    const state = fold(events, foldOptions(config))
    if ((state.closed !== null && state.closed !== 'archived') || state.stage === 'done') return []
    const input = await loadReactInput(tx, stored, state, events, config, deps.now)
    const derived = input ? react(input) : []
    for (const event of derived) await appendEvent(tx, recordId, { ...event, actor: actorOf(event) })
    if (derived.some((event) => STALES_VERIFY.includes(event.type))) {
      await releaseStaleVerify(tx, recordId, state, deps.now)
    }
    return derived
  })

export const reactToRecords = async (deps: AdvanceDeps, recordIds: number[]): Promise<void> => {
  for (const recordId of recordIds) {
    const appended = await reactLocked(deps, recordId, await deps.configFor(recordId))
    if (appended.length > 0) await advance(recordId, deps)
    if (appended.some((event) => event.type === 'pull.conflicted')) {
      await runEffects(deps, recordId, [{ kind: 'status' }])
    }
  }
}

export const reactToItems = async (deps: AdvanceDeps, items: number[]): Promise<void> =>
  reactToRecords(deps, await recordsOfItems({ db: deps.payload.db }, items))

export const reactToOpenRecords = async (deps: AdvanceDeps): Promise<void> =>
  reactToRecords(deps, await openRecords({ db: deps.payload.db }))
