import type { ModelCall } from './engine'
import { partialReply } from '../chat/stream'
import { assertFakeAllowed } from '../fake-guard'

/** E2E only (`INTAKE_FAKE=1`, never in production): deterministic interview, one step per user message. */
assertFakeAllowed('INTAKE_FAKE')

const STEPS = [
  { question: 'Who is affected, and since when?', context: '', criteria: [] as string[], options: [{ label: 'Everyone, since last week', recommended: true }, { label: 'Only some accounts' }] },
  { question: 'How should it work once it is fixed?', context: 'Finance team, since last week.', criteria: [] as string[], options: undefined },
  { question: 'Anything to add before I send this?', context: 'Finance team, since last week.', criteria: ['Totals match the invoice', 'No rounding drift on export'], options: undefined },
]

const item = (problem: string) => ({ title: problem.slice(0, 60), problem, context: 'Finance team, since last week.', acceptance_criteria: [`${problem} is fixed`, 'Nothing else changes'], type: 'bug', links: [] })
const PROBLEMS = ['The invoice total is wrong', 'The export is slow', 'The login page is confusing']

const answer = ({ messages }: Parameters<ModelCall>[0]): unknown => {
  const users = messages.filter((m) => m.role === 'user').map((m) => ({ content: typeof m.content === 'string' ? m.content : m.content.map((b) => (b.type === 'text' ? b.text : '')).join('') }))
  if (users[0].content.includes('and also')) {
    return {
      question: `I will create ${PROBLEMS.length} separate tickets: ${PROBLEMS.join(', ')}. Is that right?`,
      options: [{ label: 'Yes, create them', recommended: true }, { label: 'No, keep it as one' }],
      draft: { ...item(users[0].content.slice(0, 200)), acceptance_criteria: [] },
      split: PROBLEMS.map(item),
      needsScreenshot: false,
      missing: [],
    }
  }
  const step = STEPS[Math.min(users.length, STEPS.length) - 1]
  const first = users[0].content
  const question = /^question:/i.test(first)
  const urgent = /\b(outage|down for everyone)\b/i.test(first)
  return {
    question: question ? 'Here is the answer in plain words. Anything else?' : step.question,
    ...(!question && step.options && { options: step.options }),
    draft: { title: first.replace(/^question:\s*/i, '').slice(0, 60), problem: first.slice(0, 200), context: step.context, acceptance_criteria: step.criteria, type: question ? 'question' : /\bwish\b/i.test(first) ? 'feature' : 'bug', ...(urgent && { urgency: 'urgent', urgent_reason: 'Nobody can work, since this morning.' }), links: [] },
    needsScreenshot: false,
    missing: [],
  }
}

/** The fake model as `model` (the Workspace's tier model, shown in the conversation): it streams like the real call (the answer's JSON in chunks through `onPartial`) and reports fixed usage. */
export const fakeModelAs = (model: string): ModelCall => async (a) => {
  const out = answer(a)
  a.signal?.throwIfAborted()
  const json = JSON.stringify(out)
  if (a.onPartial) for (let at = 16; at < json.length + 16; at += 16) a.onPartial(json.slice(0, at))
  a.onUsage?.({ model, tokensIn: 10, tokensOut: Math.max(1, Math.ceil((partialReply(json, 'question') ?? '').length / 4)) })
  return out
}
export const fakeModel: ModelCall = fakeModelAs('fake')

/** E2E and tests (`BAUHERR_E2E_FAKE_FORGE=1`): owner chat classifier; a message ending in `?` asks, anything else answers. */
export const fakeOwnerModel: ModelCall = async ({ messages }) => {
  const last = messages.at(-1)!.content
  const text = typeof last === 'string' ? last : last.map((b) => (b.type === 'text' ? b.text : '')).join('')
  return text.trim().endsWith('?') ? { intent: 'explain', text: 'This decides how the work is done; the first option is the safe default.' } : { intent: 'answer', text: '' }
}
