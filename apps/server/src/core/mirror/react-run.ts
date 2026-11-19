import { inLockedRecord } from '../conn'
import { advance, type AdvanceDeps } from '../engine'
import type { AppEvent } from '../events'
import { fold, foldOptions, type Config } from '../lifecycle'
import { appendEvent, readEvents, readRecord } from '../record/store'
import { react } from './react'
import { loadReactInput, openRecords, recordsOfItems } from './react-store'

const actorOf = (event: AppEvent) => (event.type === 'reporter.replied' ? 'reporter' : 'factory')

const reactLocked = async (deps: AdvanceDeps, recordId: number, config: Config): Promise<number> =>
  inLockedRecord(deps.payload, recordId, async (tx) => {
    const stored = await readRecord(tx, recordId)
    const events = await readEvents(tx, recordId)
    const state = fold(events, foldOptions(config))
    if (state.closed !== null || state.stage === 'done') return 0
    const input = await loadReactInput(tx, stored, state, events)
    const derived = input ? react(input) : []
    for (const event of derived) await appendEvent(tx, recordId, { ...event, actor: actorOf(event) })
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
