import { z } from 'zod'
import { isBauherr } from '../lib/people'
import { inLockedRecord } from './conn'
import { AGENT_ASK, agentEntry, DECISIONS, type DecisionEntry } from './decisions'
import { advance, type AdvanceDeps } from './engine'
import { resumeParked } from './intake/pacing'
import { fold, type Card } from './fold'
import { foldOptions, next, type State, type Step } from './lifecycle'
import { appendEvent, readEvents, readRecord } from './record/store'

export const NOTE_MAX = 1000

export class DecisionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}
export class StaleDecision extends DecisionError {}
export class InvalidDecision extends DecisionError {}
export class NotAllowedToDecide extends DecisionError {}

export type Person = { id: string; role: string; workspaceIds: number[] }

export const mayDecide = (person: Person, workspace: number): boolean =>
  isBauherr({ role: person.role }) && person.workspaceIds.includes(workspace)

export type Decision = { ask: string; choice: string; seq: number; note?: string }

const noteSchema = z.string().trim().min(1).max(NOTE_MAX)

const askedOf = (step: Step, state: State): string | null => {
  if (step.kind === 'card') return step.card === 'question' ? `question:${step.reason}` : step.card
  if (step.kind === 'wait' && step.on === 'owner') {
    return state.card ? `question:${state.card.reason}` : 'production-held'
  }
  return null
}

const choiceOf = (asked: string, choice: string, card: Card | null): DecisionEntry | undefined =>
  asked === AGENT_ASK ? agentEntry(card, choice) : DECISIONS[asked]?.[choice]

type Chosen = { entry: DecisionEntry; note: string }

const entryOf = (asked: string | null, seq: number | undefined, decision: Decision, card: Card | null): Chosen => {
  if (asked !== decision.ask || seq !== decision.seq) {
    const now = asked ?? 'nothing'
    throw new StaleDecision(`The ticket is not asking ${decision.ask} (${now}): reload and decide again.`)
  }
  const entry = choiceOf(asked, decision.choice, card)
  if (!entry) throw new InvalidDecision(`${decision.choice} is not an option of ${asked}: pick one of its options.`)
  const note = noteSchema.safeParse(decision.note)
  if ((entry.needsNote || decision.note !== undefined) && !note.success) {
    throw new InvalidDecision(`The note of ${decision.choice} must have 1 to ${NOTE_MAX} characters: fix it.`)
  }
  return { entry, note: note.success ? note.data : '' }
}

export const decide = async (
  recordId: number,
  person: Person,
  decision: Decision,
  deps: AdvanceDeps,
): Promise<void> => {
  const config = await deps.configFor(recordId)
  const backlogBrief = await inLockedRecord(deps.payload, recordId, async (tx) => {
    const stored = await readRecord(tx, recordId)
    if (!mayDecide(person, stored.workspace)) {
      throw new NotAllowedToDecide(`Person ${person.id} may not decide on record ${recordId}: ask a Bauherr of it.`)
    }
    const state = fold(await readEvents(tx, recordId), foldOptions(config))
    const asked = askedOf(next(stored.record, state, config), state)
    const { entry, note } = entryOf(asked, stored.card?.seq, decision, state.card)
    const patch = state.patch
    const events = entry.events({ note, patchId: patch?.id ?? '', headSha: patch?.headSha ?? '' })
    for (const event of events) await appendEvent(tx, recordId, { ...event, actor: 'owner', actorId: person.id })
    return asked === 'brief' && stored.record.source.backlog
  })
  await advance(recordId, deps)
  if (backlogBrief) await resumeParked(deps, recordId)
}
