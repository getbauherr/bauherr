import type { ModelCall } from './engine'

/** E2E only (`INTAKE_FAKE=1`, never in production): deterministic interview, one step per user message. */
if (process.env.INTAKE_FAKE === '1' && process.env.NODE_ENV === 'production') throw new Error('INTAKE_FAKE must not be set in production')

const STEPS = [
  { question: 'Who is affected, and since when?', context: '', criteria: [] as string[] },
  { question: 'How should it work once it is fixed?', context: 'Finance team, since last week.', criteria: ['Totals match the invoice'] },
  { question: 'Anything to add before I send this?', context: 'Finance team, since last week.', criteria: ['Totals match the invoice', 'No rounding drift on export'] },
]

const item = (problem: string) => ({ problem, context: 'Finance team, since last week.', acceptance_criteria: [`${problem} is fixed`, 'Nothing else changes'], type: 'bug', links: [] })
const PROBLEMS = ['The invoice total is wrong', 'The export is slow', 'The login page is confusing']

export const fakeModel: ModelCall = async ({ messages }) => {
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
  return {
    question: step.question,
    draft: { problem: users[0].content.slice(0, 200), context: step.context, acceptance_criteria: step.criteria, type: 'bug', links: [] },
    needsScreenshot: false,
    missing: [],
  }
}
