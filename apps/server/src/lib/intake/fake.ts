import type { ModelCall } from './engine'

/** E2E only (`INTAKE_FAKE=1`, never in production): deterministic interview, one step per user message. */
if (process.env.INTAKE_FAKE === '1' && process.env.NODE_ENV === 'production') throw new Error('INTAKE_FAKE must not be set in production')

const STEPS = [
  { question: 'Who is affected, and since when?', context: '', criteria: [] as string[] },
  { question: 'How should it work once it is fixed?', context: 'Finance team, since last week.', criteria: ['Totals match the invoice'] },
  { question: 'Anything to add before I send this?', context: 'Finance team, since last week.', criteria: ['Totals match the invoice', 'No rounding drift on export'] },
]

export const fakeModel: ModelCall = async ({ messages }) => {
  const users = messages.filter((m) => m.role === 'user').map((m) => ({ content: typeof m.content === 'string' ? m.content : m.content.map((b) => (b.type === 'text' ? b.text : '')).join('') }))
  const step = STEPS[Math.min(users.length, STEPS.length) - 1]
  return {
    question: step.question,
    draft: { problem: users[0].content.slice(0, 200), context: step.context, acceptance_criteria: step.criteria, type: 'bug', links: [] },
    needsScreenshot: false,
    missing: [],
  }
}
