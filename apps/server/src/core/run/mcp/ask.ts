import { z } from 'zod'
import { askOwner } from '../../ask'
import { OptionRefused } from '../errors'
import { defineTool, leaseToken, ownRun, runId } from './tool'

const TICKET_VERB = '(?:discard|clos|park|archiv)\\w*'
const STAGE_MOVES = [
  /\bback to (?:the )?brief\b/i,
  /\bsend(?:s|ing)?\b(?:\s+\w+){0,2}\s+back\s+to\s+(?:the\s+)?(?:brief|build|verify|review|intake)\b/i,
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

const TICKET_REF =
  '(?:#\\d+|(?:ticket|issue|pr|pull\\s+request)\\s+#?\\d+|' +
  '(?!(?:19|20)\\d\\d\\b)\\d{3,}\\b' +
  '(?!\\s+(?:more|ms|milliseconds?|seconds?|minutes?|hours?|days?|weeks?|months?|years?|' +
  'rounds?|times?|runs?|attempts?|retries)\\b))'

const WAIT_FOR_TICKET = new RegExp(
  '\\b(?:wait(?:s|ing)?|hold(?:s|ing)?|pause|blocked)\\b(?:\\s+\\w+){0,3}?' +
    '\\s+(?:for|on|until|by)\\s+' + TICKET_REF + '|' +
    '\\b(?:start|begin|resume|continue|build)\\b[^.]*?\\bafter\\s+' + TICKET_REF,
  'i',
)

const refuseWaiting = (options: string[]): void => {
  const offending = options.find((option) => WAIT_FOR_TICKET.test(option))
  if (offending) {
    throw new OptionRefused(
      `Option "${offending}" offers waiting for another ticket: ` +
        'a blocked ticket already waits by itself before Build. ' +
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
    refuseWaiting(input.options)
    await askOwner(input.runId, input.leaseToken, { text: input.question, options: input.options }, context.deps)
    return { status: 'asked' as const }
  },
})
