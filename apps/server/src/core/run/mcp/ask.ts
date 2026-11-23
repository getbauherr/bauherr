import { z } from 'zod'
import { askOwner } from '../../ask'
import { OptionRefused } from '../errors'
import { defineTool, leaseToken, ownRun, runId } from './tool'

const TICKET_VERB = '(?:discard|clos|park|archiv)\\w*'
const STAGE_MOVES = [
  /\bback to (?:the )?brief\b/i,
  /\bsend(?:s|ing)?\b(?:\s+\w+){0,2}\s+back\s+to\b/i,
  new RegExp(`\\b${TICKET_VERB}\\b(?:\\s+\\w+){0,2}\\s+(?:ticket|issue|brief)\\b`, 'i'),
  new RegExp(`^\\s*${TICKET_VERB}\\s*(?::|-|$)`, 'i'),
]

const refuseStageMoves = (options: string[]): void => {
  const offending = options.find((option) => STAGE_MOVES.some((move) => move.test(option)))
  if (offending) {
    throw new OptionRefused(
      `Option "${offending}" promises a move an answer cannot make: Back to Brief is already on the card. ` +
        'Write options as answers for your next run.',
    )
  }
}

export const ask = defineTool({
  name: 'ask',
  description:
    'Raises a question to the owner with 2 to 4 options and ends your run. ' +
    'Returns once the question is open; options are answers for your next run, never stage moves.',
  access: 'agent',
  input: z.strictObject({
    runId,
    leaseToken,
    question: z.string().trim().min(1).max(200),
    options: z.array(z.string().trim().min(1).max(100)).min(2).max(4),
  }),
  run: async (input, context) => {
    await ownRun(context, input.runId)
    refuseStageMoves(input.options)
    await askOwner(input.runId, input.leaseToken, { text: input.question, options: input.options }, context.deps)
    return { status: 'asked' as const }
  },
})
