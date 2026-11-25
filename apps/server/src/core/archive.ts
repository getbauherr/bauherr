import { inLockedRecord } from './conn'
import { InvalidDecision, mayDecide, notPlanned, NotAllowedToDecide, type Person } from './decide'
import { runEffects } from './effects'
import { advance, type AdvanceDeps } from './engine'
import type { AppEvent } from './events'
import { fold } from './fold'
import { canArchive, foldOptions, type State } from './lifecycle'
import { closedByAdoptedPull } from './views/ticket-parts'
import { appendEvent, readEvents, readRecord } from './record/store'

type Plan = { events: AppEvent[]; allowed: (state: State) => boolean; refusal: string }

const archiving: Plan = {
  events: [{ type: 'ticket.closed', data: { reason: 'archived' } }],
  allowed: canArchive,
  refusal: 'Only a ticket before Ship that is still open can be archived: reload the page.',
}

const restoring: Plan = {
  events: [{ type: 'ticket.restored', data: {} }],
  allowed: (state) => state.closed === 'archived' || state.closed === 'closed-on-forge',
  refusal: 'Only an archived or forge-closed ticket can be restored: reload the page.',
}

const inState = async (deps: AdvanceDeps, recordId: number, person: Person, plan: Plan) => {
  const stored = await readRecord(deps.payload, recordId)
  if (!mayDecide(person, stored.workspace)) {
    throw new NotAllowedToDecide(`Person ${person.id} may not decide on record ${recordId}: ask a Bauherr of it.`)
  }
  const state = fold(await readEvents(deps.payload, recordId), foldOptions(await deps.configFor(recordId)))
  if (!plan.allowed(state)) throw new InvalidDecision(plan.refusal)
  if (plan === restoring && state.closed === 'closed-on-forge' && (await closedByAdoptedPull(deps.payload, stored))) {
    throw new InvalidDecision('The pull request was closed on the forge: reopen it there and the ticket follows.')
  }
}

const append = async (deps: AdvanceDeps, recordId: number, person: Person, plan: Plan): Promise<void> => {
  const config = await deps.configFor(recordId)
  await inLockedRecord(deps.payload, recordId, async (tx) => {
    const state = fold(await readEvents(tx, recordId), foldOptions(config))
    if (!plan.allowed(state)) return
    for (const event of plan.events) await appendEvent(tx, recordId, { ...event, actor: 'owner', actorId: person.id })
  })
}

export const archive = async (recordId: number, person: Person, deps: AdvanceDeps): Promise<void> => {
  await inState(deps, recordId, person, archiving)
  await append(deps, recordId, person, archiving)
  await advance(recordId, deps)
  await runEffects(deps, recordId, notPlanned('Archived', person))
}

export const restore = async (recordId: number, person: Person, deps: AdvanceDeps): Promise<void> => {
  await inState(deps, recordId, person, restoring)
  await runEffects(deps, recordId, [{ kind: 'reopen' }])
  await append(deps, recordId, person, restoring)
  await advance(recordId, deps)
}
