import { z } from 'zod'
import { DECISIONS, type DecisionEntry } from './decisions'
import { advance, type AdvanceDeps } from './engine'
import { fold, next, type State, type Step } from './lifecycle'
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

export type Decision = { ask: string; choice: string; note?: string }

const noteSchema = z.string().trim().min(1).max(NOTE_MAX)

const askedOf = (step: Step, state: State): string | null => {
  if (step.kind === 'card') return step.card === 'question' ? `question:${step.reason}` : step.card
  if (step.kind === 'wait' && step.on === 'owner') {
    return state.card ? `question:${state.card.reason}` : 'production-held'
  }
  return null
}

const entryOf = (asked: string | null, decision: Decision): { entry: DecisionEntry; note: string } => {
  if (asked !== decision.ask) {
    const now = asked ?? 'nothing'
    throw new StaleDecision(`The ticket is not asking ${decision.ask} (${now}): reload and decide again.`)
  }
  const entry = DECISIONS[asked]?.[decision.choice]
  if (!entry) throw new InvalidDecision(`${decision.choice} is not an option of ${asked}: pick one of its options.`)
  const note = noteSchema.safeParse(decision.note)
  if ((entry.needsNote || decision.note !== undefined) && !note.success) {
    throw new InvalidDecision(`The note of ${decision.choice} must have 1 to ${NOTE_MAX} characters: fix it.`)
  }
  return { entry, note: note.success ? note.data : '' }
}

export const decide = async (
  recordId: number,
  by: { id: string },
  decision: Decision,
  deps: AdvanceDeps,
): Promise<void> => {
  const config = await deps.configFor(recordId)
  const stored = await readRecord(deps.payload, recordId)
  const state = fold(await readEvents(deps.payload, recordId), { productionGate: config.productionGate })
  const { entry, note } = entryOf(askedOf(next(stored.record, state, config), state), decision)
  const events = entry.events({ note, patchId: state.patch?.id ?? '', headSha: state.patch?.headSha ?? '' })
  for (const event of events) await appendEvent(deps.payload, recordId, { ...event, actor: 'owner', actorId: by.id })
  await advance(recordId, deps)
}
