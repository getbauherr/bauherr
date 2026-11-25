import { z } from 'zod'
import { answersProblem, storeAnswers, type Answers } from './answers'
import { isBauherr } from '../lib/people'
import { inLockedRecord, type Conn } from './conn'
import {
  AGENT_ASK,
  agentEntry,
  BACK_TO_BRIEF,
  DECISIONS,
  WORKING_ASK,
  withComment,
  type DecisionEntry,
} from './decisions'
import type { AppEvent } from './events'
import { runEffects } from './effects'
import { advance, type AdvanceDeps } from './engine'
import { createKept } from './relations/keep'
import { resumeParked } from './intake/pacing'
import { fold } from './fold'
import { NOTE_MAX } from './limits'
import { canGoBack, foldOptions, next, type State, type Step } from './lifecycle'
import type { Effect } from './module'
import type { ProposedRelation, TicketRecord } from './record/schema'
import { appendEvent, patchRecord, readEvents, readRecord, type StoredRecord } from './record/store'
import { releaseLive } from './run/leases'


const DISCARDING = ['brief', 'question:failed-runs', 'question:verify-rounds']

export class DecisionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}
export class StaleDecision extends DecisionError {}
export class InvalidDecision extends DecisionError {}
export class NotAllowedToDecide extends DecisionError {}

export type Person = { id: string; role: string; workspaceIds: number[]; name?: string }

export const mayDecide = (person: Person, workspace: number): boolean =>
  isBauherr({ role: person.role }) && person.workspaceIds.includes(workspace)

export type Decision = {
  ask: string
  choice: string
  seq: number
  note?: string
  answers?: Answers
  dropRelations?: number[]
}

const noteSchema = z.string().trim().min(1).max(NOTE_MAX)

const askedOf = (step: Step, state: State): string | null => {
  if (step.kind === 'card') return step.card === 'question' ? `question:${step.reason}` : step.card
  if (step.kind === 'wait' && step.on === 'owner') {
    return state.card ? `question:${state.card.reason}` : null
  }
  return canGoBack(state) ? WORKING_ASK : null
}

const choiceOf = (asked: string, choice: string, state: State): DecisionEntry | undefined => {
  if (asked !== AGENT_ASK) return DECISIONS[asked]?.[choice]
  if (choice === BACK_TO_BRIEF && !canGoBack(state)) return undefined
  return DECISIONS[asked]?.[choice] ?? agentEntry(state.card, choice)
}

type Settled = { entry: DecisionEntry; answers: Answers | null }

type Chosen = { entry: DecisionEntry; note: string }

const entryOf = (asked: string | null, seq: number, decision: Decision, state: State): Chosen => {
  if (asked !== decision.ask || seq !== decision.seq) {
    const now = asked ?? 'nothing'
    throw new StaleDecision(`The ticket is not asking ${decision.ask} (${now}): reload and decide again.`)
  }
  const entry = choiceOf(asked, decision.choice, state)
  if (!entry) throw new InvalidDecision(`${decision.choice} is not an option of ${asked}: pick one of its options.`)
  const note = noteSchema.safeParse(decision.note)
  if ((entry.needsNote || decision.note !== undefined) && !note.success) {
    throw new InvalidDecision(`The note of ${decision.choice} must have 1 to ${NOTE_MAX} characters: fix it.`)
  }
  return { entry, note: note.success ? note.data : '' }
}

const answersOf = (asked: string | null, decision: Decision, record: TicketRecord): Answers | null => {
  if (asked !== 'brief' || decision.choice !== 'approve') {
    if (decision.answers === undefined) return null
    throw new InvalidDecision(`Only approving a Brief takes answers: leave answers out of ${decision.choice}.`)
  }
  const answers = decision.answers ?? {}
  const problem = answersProblem(record, answers)
  if (problem !== null) throw new InvalidDecision(problem)
  return answers
}

const keptRelations = (asked: string | null, decision: Decision, record: TicketRecord): ProposedRelation[] => {
  const dropped = decision.dropRelations ?? []
  if (asked !== 'brief' || decision.choice !== 'approve') {
    if (dropped.length === 0) return []
    throw new InvalidDecision(`Only approving a Brief drops relations: leave dropRelations out of ${decision.choice}.`)
  }
  if (dropped.some((i) => !Number.isInteger(i) || i < 0 || i >= record.relations.length)) {
    throw new InvalidDecision('dropRelations names a relation this Brief does not propose: drop only listed ones.')
  }
  return record.relations.filter((_, i) => !dropped.includes(i))
}

const eventsOf = (entry: DecisionEntry, state: State, note: string): AppEvent[] => {
  const input = {
    note,
    patchId: state.patch?.id ?? '',
    headSha: state.patch?.headSha ?? '',
    question: state.card?.text ?? '',
  }
  return withComment(entry, entry.events(input), note)
}

const sentBackReview = (asked: string | null, choice: string, state: State, note: string): Effect[] => {
  if (asked !== 'result' || choice !== 'send-back') return []
  if (state.merged) return [{ kind: 'reopen' }]
  const adoptedPatch = state.adopted ? state.patch : null
  return adoptedPatch === null ? [] : [{ kind: 'review', pr: adoptedPatch.pr, body: note }]
}

const settle = async (tx: Conn, stored: StoredRecord, chosen: Settled, now: Date): Promise<void> => {
  if (chosen.entry.endsRun) await releaseLive(tx, stored.id, now)
  if (chosen.answers) await storeAnswers(tx, stored.id, stored, chosen.answers, now)
}

const keepOnly = async (tx: Conn, recordId: number, relations: ProposedRelation[]): Promise<void> => {
  const current = await readRecord(tx, recordId)
  await patchRecord(tx, recordId, {
    expectedVersion: current.version,
    writes: ['relations'],
    patch: { relations },
    by: { stage: 'brief', runId: 'owner' },
  })
}

const closedAsDone = (asked: string | null, choice: string, state: State): Effect[] => {
  if (asked !== 'question:already-done' || choice !== 'close-as-done' || state.alreadyDone === null) return []
  const { by, evidence } = state.alreadyDone
  return [
    { kind: 'question', body: `Closing as already done by ${by}: ${evidence}` },
    { kind: 'close', reason: 'completed' },
  ]
}

export const notPlanned = (verb: 'Archived' | 'Discarded', person: Person): Effect[] => [
  { kind: 'question', body: `${verb} by ${person.name ?? 'the owner'}.` },
  { kind: 'close', reason: 'not_planned' },
]

const discarded = (asked: string | null, choice: string, person: Person): Effect[] =>
  choice === 'discard' && asked !== null && DISCARDING.includes(asked) ? notPlanned('Discarded', person) : []

export const decide = async (
  recordId: number,
  person: Person,
  decision: Decision,
  deps: AdvanceDeps,
): Promise<void> => {
  const config = await deps.configFor(recordId)
  const { backlogBrief, review, kept } = await inLockedRecord(deps.payload, recordId, async (tx) => {
    const stored = await readRecord(tx, recordId)
    if (!mayDecide(person, stored.workspace)) {
      throw new NotAllowedToDecide(`Person ${person.id} may not decide on record ${recordId}: ask a Bauherr of it.`)
    }
    const state = fold(await readEvents(tx, recordId), foldOptions(config))
    const asked = askedOf(next(stored.record, state, config), state)
    const { entry, note } = entryOf(asked, stored.card?.seq ?? 0, decision, state)
    const answers = answersOf(asked, decision, stored.record)
    const kept = keptRelations(asked, decision, stored.record)
    const events = eventsOf(entry, state, note)
    for (const event of events) await appendEvent(tx, recordId, { ...event, actor: 'owner', actorId: person.id })
    await settle(tx, stored, { entry, answers }, deps.now)
    if (kept.length !== stored.record.relations.length) await keepOnly(tx, recordId, kept)
    return {
      kept,
      backlogBrief: asked === 'brief' && stored.record.source.backlog,
      review: [
        ...sentBackReview(asked, decision.choice, state, note),
        ...closedAsDone(asked, decision.choice, state),
        ...discarded(asked, decision.choice, person),
      ],
    }
  })
  await advance(recordId, deps)
  await createKept(deps, recordId, kept)
  await runEffects(deps, recordId, review)
  if (backlogBrief) await resumeParked(deps, recordId)
}
