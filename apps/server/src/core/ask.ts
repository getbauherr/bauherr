import { inLockedRecord } from './conn'
import { advance, type AdvanceDeps } from './engine'
import { appendEvent } from './record/store'
import { release } from './run/leases'
import { readRun } from './run/store'

export type AgentQuestion = { text: string; options: string[] }

export const askOwner = async (
  runId: number,
  token: string,
  question: AgentQuestion,
  deps: AdvanceDeps,
): Promise<void> => {
  const run = await readRun(deps.payload, runId)
  await inLockedRecord(deps.payload, run.recordId, async (tx) => {
    await release(tx, runId, token, deps.now)
    const data = { reason: 'agent', options: question.options, text: question.text }
    await appendEvent(tx, run.recordId, { type: 'question.asked', data, actor: 'agent' })
    const released = { stage: run.stage, runId: String(run.id) }
    await appendEvent(tx, run.recordId, { type: 'run.released', data: released, actor: 'factory' })
  })
  await advance(run.recordId, deps)
}
