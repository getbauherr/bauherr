import type { AppEvent } from './events'
import type { State } from './fold'

export const withLearning = (state: State, event: AppEvent): State => {
  const { corrected, learned } = state.learn
  switch (event.type) {
    case 'result.sent-back':
    case 'brief.changes-requested':
      return { ...state, learn: { corrected: true, learned } }
    case 'learn.skipped':
      return { ...state, learn: { corrected, learned: true } }
    case 'learn.submitted': {
      const run = state.run?.runId === event.data.runId ? null : state.run
      return { ...state, run, failedRuns: 0, learn: { corrected, learned: true } }
    }
    default:
      return state
  }
}
