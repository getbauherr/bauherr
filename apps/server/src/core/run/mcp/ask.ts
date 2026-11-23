import { z } from 'zod'
import { askOwner } from '../../ask'
import { defineTool, leaseToken, ownRun, runId } from './tool'

export const ask = defineTool({
  name: 'ask',
  description:
    'Raises a question to the owner with 2 to 4 options and ends your run. ' +
    'Returns once the question is open; an answer runs your stage again with the answer as a note.',
  access: 'agent',
  input: z.strictObject({
    runId,
    leaseToken,
    question: z.string().trim().min(1).max(200),
    options: z.array(z.string().trim().min(1).max(100)).min(2).max(4),
  }),
  run: async (input, context) => {
    await ownRun(context, input.runId)
    await askOwner(input.runId, input.leaseToken, { text: input.question, options: input.options }, context.deps)
    return { status: 'asked' as const }
  },
})
