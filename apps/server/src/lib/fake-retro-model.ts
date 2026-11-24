import type { RetroContext } from '../core/retro/prompt'
import type { RetroModel } from '../core/retro/model'

const contextOf = (first: string): RetroContext => JSON.parse(first.slice(first.indexOf('\n') + 1)) as RetroContext

const opening = (context: RetroContext): string => {
  const off = context.opening.tickets[0]
  return JSON.stringify({
    message: `${off?.title ?? 'One ticket'} stands out. What went well from your side, and what did not?`,
    proposals: [
      {
        id: 'p1',
        level: 'product',
        title: 'Should a change that is sent back twice get a mockup before Build?',
        cause: 'The far-off ticket was built without a mockup and came back several times.',
        evidence: off ? [off.recordId] : [],
        confidence: 'high',
        change: { section: 'Brief', remove: null, add: '- A change a user sees gets a mockup before Build.' },
      },
    ],
    agreed: [],
  })
}

const followUp = (said: string): string =>
  JSON.stringify({
    message: `Understood: ${said.slice(0, 80)}. Here is a second point for the workspace.`,
    proposals: [
      {
        id: 'p2',
        level: 'workspace',
        title: 'Should a question you already answered not be asked again?',
        cause: 'Questions to you went up.',
        evidence: [],
        confidence: 'medium',
        change: { section: 'All stages', remove: null, add: '- A question the owner answered is not asked again.' },
      },
    ],
    agreed: ['p2'],
  })

export const fakeRetroModel: RetroModel = async (_workspace, _system, turns) => {
  const first = turns[0]?.content ?? ''
  const last = turns[turns.length - 1]
  return turns.length === 1 ? opening(contextOf(first)) : followUp(last?.content ?? '')
}
