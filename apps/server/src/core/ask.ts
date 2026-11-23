import { inLockedRecord } from './conn'
import { advance, type AdvanceDeps } from './engine'
import { appendEvent } from './record/store'
import { release } from './run/leases'
import { readRun } from './run/store'

export type AgentQuestion = { text: string; options: string[] }

export const PARKED_OPTIONS = ['resume', 'discard']

const raise = async (
  runId: number,
  token: string,
  data: { reason: string; options: string[]; text: string },
  deps: AdvanceDeps,
): Promise<void> => {
  const run = await readRun(deps.payload, runId)
  await inLockedRecord(deps.payload, run.recordId, async (tx) => {
    await release(tx, runId, token, deps.now)
    await appendEvent(tx, run.recordId, { type: 'question.asked', data, actor: 'agent' })
    const released = { stage: run.stage, runId: String(run.id) }
    await appendEvent(tx, run.recordId, { type: 'run.released', data: released, actor: 'factory' })
  })
  await advance(run.recordId, deps)
}

export const askOwner = (runId: number, token: string, question: AgentQuestion, deps: AdvanceDeps): Promise<void> =>
  raise(runId, token, { reason: 'agent', options: question.options, text: question.text }, deps)

export const parkOnNeed = (runId: number, token: string, need: string, deps: AdvanceDeps): Promise<void> =>
  raise(runId, token, { reason: 'parked', options: PARKED_OPTIONS, text: need }, deps)
