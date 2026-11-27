import { DECISIONS, DROP_CRITERIA } from '../decisions'
import { DecisionError, droppedOf } from '../decide'
import type { TicketView } from '../views/ticket'
import { ANSWER, COMMENT_TO_AGENT, type SteerReply } from './reply'

export type DecideIntent = {
  recordId: number
  ask: string
  seq: number
  choice: string
  note?: string
  criteria?: string[]
  answers?: Record<string, string>
}

export type Intent =
  | { kind: 'answer'; text: string }
  | { kind: 'refused'; text: string }
  | { kind: 'comment'; text: string; body: string }
  | { kind: 'decide'; text: string; input: DecideIntent }

const WORDS: Record<string, string> = {
  approve: 'approve the Brief',
  'request-changes': 'send the Brief back with your note',
  discard: 'discard it',
  accept: 'accept the result',
  'send-back': 'send the result back with your note',
  retry: 'retry it',
  'retry-with-guidance': 'retry it with your guidance',
  'one-more-round': 'grant one more review round',
  'accept-anyway': 'accept it anyway',
  'retry-brief': 'write the Brief again',
}

const joined = (say: string, line: string): string => (say === '' ? line : `${say}\n\n${line}`)

const refused = (reply: SteerReply, number: number, why: string): Intent => ({
  kind: 'refused',
  text: joined(reply.say, `I cannot do that on #${number}: ${why}`),
})

const openAnswers = (view: TicketView): Record<string, string> =>
  Object.fromEntries(
    view.record.decisions.filter((open) => open.answer === undefined).map((open) => [open.id, open.recommended]),
  )

const inputOf = (view: TicketView, reply: SteerReply, ask: string, seq: number): DecideIntent => {
  const answers = ask === 'brief' && reply.tool === 'approve' ? openAnswers(view) : {}
  return {
    recordId: view.recordId,
    ask,
    seq,
    choice: reply.tool,
    ...(reply.note ? { note: reply.note } : {}),
    ...(reply.tool === DROP_CRITERIA ? { criteria: reply.criteria ?? [] } : {}),
    ...(Object.keys(answers).length > 0 ? { answers } : {}),
  }
}

const dropProblem = (view: TicketView, input: DecideIntent): string | null => {
  try {
    droppedOf(input, view.record)
    return null
  } catch (error) {
    if (error instanceof DecisionError) return error.message
    throw error
  }
}

const problemOf = (view: TicketView, reply: SteerReply, input: DecideIntent | null): string | null => {
  const { decision } = view
  if (decision === null || input === null || !decision.options.includes(reply.tool)) {
    return `"${reply.tool}" is not one of the options the ticket asks you now.`
  }
  if (DECISIONS[decision.ask]?.[reply.tool]?.needsNote === true && !reply.note) {
    return `"${reply.tool}" needs your words: say what it should say.`
  }
  return reply.tool === DROP_CRITERIA ? dropProblem(view, input) : null
}

const actionOf = (input: DecideIntent, number: number): string =>
  input.choice === DROP_CRITERIA
    ? `drop ${(input.criteria ?? []).join(', ')} from #${number}, without a new Brief`
    : `${WORDS[input.choice] ?? input.choice} on #${number}`

const decideIntent = (view: TicketView, reply: SteerReply): Intent => {
  const { card, decision, number } = view
  const input = card && decision ? inputOf(view, reply, decision.ask, card.seq) : null
  const problem = problemOf(view, reply, input)
  if (problem !== null || input === null) return refused(reply, number, problem ?? '')
  return { kind: 'decide', input, text: joined(reply.say, `I will ${actionOf(input, number)}.`) }
}

const commentIntent = (view: TicketView, reply: SteerReply): Intent => {
  if (!reply.note) return refused(reply, view.number, 'I need the words to pass on.')
  return {
    kind: 'comment',
    body: reply.note,
    text: joined(reply.say, `I will pass this to the agent working on #${view.number}: "${reply.note}"`),
  }
}

export const intentOf = (view: TicketView, reply: SteerReply): Intent => {
  if (reply.tool === ANSWER) return { kind: 'answer', text: reply.say === '' ? 'I have nothing to add.' : reply.say }
  return reply.tool === COMMENT_TO_AGENT ? commentIntent(view, reply) : decideIntent(view, reply)
}
