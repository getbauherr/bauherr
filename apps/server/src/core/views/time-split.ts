import type { AppEvent, Stage } from '../events'
import { initialState, reduce, type State } from '../fold'

export const PARTS = ['agent', 'you', 'ci', 'queued'] as const
export type Part = (typeof PARTS)[number]
export type Split = Record<Part, number>
export type TimedEvent = { event: AppEvent; at: Date }
export type TimedRun = { createdAt: Date; startedAt: Date | null; finishedAt: Date | null }
export type Stay = { stage: Exclude<Stage, 'done'>; seconds: number; split: Split }

export type TicketTime = {
  createdAt: Date
  doneAt: Date | null
  closed: boolean
  seconds: number
  stays: Stay[]
  you: number
  verifyRounds: number
  sentBack: number
  briefsChanged: number
}

type Step = { from: number; state: State; next: AppEvent | undefined }

const OPTIONS = { productionGate: false }
const ACCEPTING = ['result.accepted', 'ticket.done-elsewhere']
const DEPLOYING = ['ship.deployed', 'ship.deploy-stalled']

export const emptySplit = (): Split => ({ agent: 0, you: 0, ci: 0, queued: 0 })

const count = (events: TimedEvent[], type: AppEvent['type']): number =>
  events.filter((entry) => entry.event.type === type).length

export const doneAtOf = (events: TimedEvent[], closed: boolean): Date | null => {
  if (closed) return null
  const accepted = events.findLastIndex((entry) => ACCEPTING.includes(entry.event.type))
  if (accepted < 0) return null
  const sentBack = events.findLastIndex((entry) => entry.event.type === 'result.sent-back')
  return sentBack > accepted ? null : (events[accepted]?.at ?? null)
}

const stepsOf = (createdAt: Date, events: TimedEvent[]): { steps: Step[]; last: State } => {
  let state = initialState()
  const steps: Step[] = [{ from: createdAt.getTime(), state, next: events[0]?.event }]
  events.forEach((entry, index) => {
    state = reduce(state, entry.event, OPTIONS)
    steps.push({ from: entry.at.getTime(), state, next: events[index + 1]?.event })
  })
  return { steps, last: state }
}

const resultWait = (state: State, deploys: boolean): Part | null => {
  if (state.accepted) return null
  if (state.adopted) return 'you'
  if (!state.merged) return null
  return deploys && !state.deployed ? 'ci' : 'you'
}

const briefWait = (state: State, next: AppEvent | undefined): Part | null => {
  const byRule = next?.type === 'brief.approved' && next.data.by === 'rule'
  return state.brief === 'submitted' && state.note === null && !byRule ? 'you' : null
}

const verifyWait = (state: State): Part | null =>
  state.patch !== null && state.reviewed === state.patch.id && state.checks === 'pending' ? 'ci' : null

const waitOf = (state: State, next: AppEvent | undefined, deploys: boolean): Part | null => {
  if (state.closed !== null || state.stage === 'done') return null
  if (state.card !== null) return 'you'
  if (state.stage === 'brief') return briefWait(state, next)
  if (state.stage === 'verify') return verifyWait(state)
  return state.stage === 'ship' ? resultWait(state, deploys) : null
}

const within = (from: number | null, at: number, until: number): boolean => from !== null && from <= at && at < until

const runKind = (runs: TimedRun[], at: number, end: number): Part | null => {
  const kinds = runs.map((run): Part | null => {
    const claimed = run.startedAt?.getTime() ?? null
    const over = run.finishedAt?.getTime() ?? end
    if (within(claimed, at, over)) return 'agent'
    return within(run.createdAt.getTime(), at, claimed ?? over) ? 'queued' : null
  })
  return kinds.includes('agent') ? 'agent' : kinds.includes('queued') ? 'queued' : null
}

const stepAt = (steps: Step[], at: number): Step | undefined => steps.findLast((step) => step.from <= at)

const points = (steps: Step[], runs: TimedRun[], start: number, end: number): number[] => {
  const raw = [start, end, ...steps.map((step) => step.from)]
  for (const run of runs) {
    raw.push(run.createdAt.getTime(), run.startedAt?.getTime() ?? 0, run.finishedAt?.getTime() ?? 0)
  }
  return [...new Set(raw.filter((time) => time >= start && time <= end))].sort((a, b) => a - b)
}

const addStay = (stays: Stay[], stage: Stay['stage'], seconds: number, part: Part | null): void => {
  const last = stays.at(-1)
  const stay = last?.stage === stage ? last : { stage, seconds: 0, split: emptySplit() }
  if (stay !== last) stays.push(stay)
  stay.seconds += seconds
  if (part !== null) stay.split[part] += seconds
}

export const timeOf = (input: {
  createdAt: Date
  events: TimedEvent[]
  runs: TimedRun[]
  now: Date
}): TicketTime => {
  const { createdAt, events, runs, now } = input
  const { steps, last } = stepsOf(createdAt, events)
  const doneAt = doneAtOf(events, last.closed !== null)
  const closedAt = last.closed === null ? null : (events.at(-1)?.at ?? now)
  const start = createdAt.getTime()
  const end = Math.max(start, (doneAt ?? closedAt ?? now).getTime())
  const deploys = events.some((entry) => DEPLOYING.includes(entry.event.type))
  const marks = points(steps, runs, start, end)
  const stays: Stay[] = []
  marks.slice(0, -1).forEach((from, index) => {
    const step = stepAt(steps, from)
    if (!step || step.state.stage === 'done') return
    const part = runKind(runs, from, end) ?? waitOf(step.state, step.next, deploys)
    addStay(stays, step.state.stage, ((marks[index + 1] ?? from) - from) / 1000, part)
  })
  return {
    createdAt,
    doneAt,
    closed: last.closed !== null,
    seconds: (end - start) / 1000,
    stays,
    you: stays.reduce((sum, stay) => sum + stay.split.you, 0),
    verifyRounds: count(events, 'verify.changes'),
    sentBack: count(events, 'result.sent-back'),
    briefsChanged: count(events, 'brief.changes-requested'),
  }
}
