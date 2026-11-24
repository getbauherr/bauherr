import { AGENT_SILENCE_MS } from './holds'

export type HealthWord = 'Working' | 'Waiting for a session' | 'Stuck' | 'Failed' | 'Finished'
export type HealthAction = 'connect' | 'ticket' | null
export type RunHealth = { word: HealthWord; sentence: string; action: HealthAction }

export type HealthRun = {
  status: string
  role: string
  error: string | null
  updatedAt: Date
  startedAt: Date
}

const minutes = (from: Date, now: Date): number => Math.max(0, Math.floor((now.getTime() - from.getTime()) / 60_000))

const failure = (verb: string, run: HealthRun): RunHealth => ({
  word: 'Failed',
  sentence: `The run ${verb}${run.error ? `: ${run.error}` : '.'}`,
  action: 'ticket',
})

const queued = (run: HealthRun, session: boolean): RunHealth =>
  session
    ? {
        word: 'Working',
        sentence: `Queued. A ${run.role} session is connected and takes it next.`,
        action: null,
      }
    : {
        word: 'Waiting for a session',
        sentence: `No ${run.role} session is connected. This run starts when one claims it.`,
        action: 'connect',
      }

const claimed = (run: HealthRun, now: Date): RunHealth => {
  const silent = now.getTime() - run.updatedAt.getTime()
  if (silent >= AGENT_SILENCE_MS) {
    return {
      word: 'Stuck',
      sentence: `No sign of life for ${minutes(run.updatedAt, now)} min. The agent may have stopped.`,
      action: null,
    }
  }
  const sentence = `Working. Last sign of life ${minutes(run.updatedAt, now)} min ago.`
  return { word: 'Working', sentence, action: null }
}

export const runHealth = (run: HealthRun, session: boolean, now: Date): RunHealth => {
  switch (run.status) {
    case 'queued':
      return queued(run, session)
    case 'claimed':
      return claimed(run, now)
    case 'submitted':
      return { word: 'Finished', sentence: 'The run finished and handed its result on.', action: null }
    case 'failed':
      return failure('failed', run)
    case 'expired':
      return failure('expired', run)
    default:
      return failure('was released before it finished', run)
  }
}
