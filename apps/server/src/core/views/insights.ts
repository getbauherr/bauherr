import { STAGES } from '../events'
import { emptySplit, PARTS, type Part, type Split, type Stay, type TicketTime } from './time-split'

export type StageTime = { stage: Stay['stage']; stays: number; seconds: number; split: Split }
export type LargestWait = { part: Exclude<Part, 'agent'>; stage: Stay['stage'] }

export type TimeSummary = {
  done: number
  medianSeconds: number | null
  verifyRoundsPerTicket: number | null
  verifyRoundsMedian: number | null
  moreThanOneRoundShare: number | null
  sentBackShare: number | null
  stages: StageTime[]
  largestWait: LargestWait | null
  sentence: string | null
}

const WAITS = ['you', 'ci', 'queued'] as const
const NAMES: Record<LargestWait['part'], string> = {
  you: 'Waiting on you',
  ci: 'Waiting on CI',
  queued: 'Queued with no agent',
}

export const median = (values: number[]): number | null => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 === 1 ? (sorted[middle] ?? null) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

const label = (stage: string): string => `${stage.slice(0, 1).toUpperCase()}${stage.slice(1)}`

const stageTime = (stage: Stay['stage'], stays: Stay[]): StageTime => {
  const total = stays.reduce((sum, stay) => sum + stay.seconds, 0)
  const seconds = median(stays.map((stay) => stay.seconds)) ?? 0
  const split = emptySplit()
  for (const part of PARTS) {
    const share = stays.reduce((sum, stay) => sum + stay.split[part], 0)
    split[part] = total === 0 ? 0 : (seconds * share) / total
  }
  return { stage, stays: stays.length, seconds, split }
}

const largestWaitOf = (stays: Stay[]): LargestWait | null => {
  let best: { wait: LargestWait; seconds: number } | null = null
  for (const stage of STAGES.filter((s): s is Stay['stage'] => s !== 'done')) {
    for (const part of WAITS) {
      const seconds = stays.filter((s) => s.stage === stage).reduce((sum, stay) => sum + stay.split[part], 0)
      if (seconds > (best?.seconds ?? 0)) best = { wait: { part, stage }, seconds }
    }
  }
  return best?.wait ?? null
}

export const sentenceOf = (wait: LargestWait | null): string | null =>
  wait === null ? null : `${NAMES[wait.part]} is the largest share in ${label(wait.stage)}.`

const mean = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length

export const summarize = (tickets: TicketTime[]): TimeSummary => {
  const stays = tickets.flatMap((ticket) => ticket.stays)
  const largestWait = largestWaitOf(stays)
  return {
    done: tickets.length,
    medianSeconds: median(tickets.map((ticket) => ticket.seconds)),
    verifyRoundsPerTicket: mean(tickets.map((ticket) => ticket.verifyRounds)),
    verifyRoundsMedian: median(tickets.map((ticket) => ticket.verifyRounds)),
    moreThanOneRoundShare: mean(tickets.map((ticket) => (ticket.verifyRounds > 1 ? 1 : 0))),
    sentBackShare: mean(tickets.map((ticket) => (ticket.sentBack > 0 ? 1 : 0))),
    stages: STAGES.filter((stage): stage is Stay['stage'] => stage !== 'done')
      .map((stage) => stageTime(stage, stays.filter((stay) => stay.stage === stage)))
      .filter((row) => row.stays > 0),
    largestWait,
    sentence: sentenceOf(largestWait),
  }
}
