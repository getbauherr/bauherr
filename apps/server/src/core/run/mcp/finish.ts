import { z } from 'zod'
import { releaseRun, submit as submitResult } from '../../submit'
import { defineTool, leaseToken, ownRun, runId } from './tool'

export const submit = defineTool({
  name: 'submit',
  description:
    'Submits the result of your run. ' +
    'Returns accepted, or the list of problems: an invalid result gets exactly one fix turn.',
  access: 'agent',
  input: z.strictObject({ runId, leaseToken, result: z.unknown() }),
  run: async (input, context) => {
    await ownRun(context, input.runId)
    return submitResult(input.runId, input.leaseToken, input.result, context.deps)
  },
})

export const release = defineTool({
  name: 'release',
  description: 'Gives up your run so that another session can work on it. Returns once the run is released.',
  access: 'agent',
  input: z.strictObject({ runId, leaseToken }),
  run: async (input, context) => {
    await ownRun(context, input.runId)
    await releaseRun(input.runId, input.leaseToken, context.deps)
    return { status: 'released' as const }
  },
})
