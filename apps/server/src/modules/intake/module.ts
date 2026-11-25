import { z } from 'zod'
import { questionsBody } from '../../core/intake/questions'
import { defineModule, type Applied, type Effect } from '../../core/module'
import { TYPES } from '../../core/record/schema'

const text = (max: number) => z.string().trim().min(1).max(max)

const OUTCOMES = ['accepted', 'needs-info', 'duplicate', 'not-planned', 'not-a-bug', 'disputed'] as const

const question = z.object({ text: text(200), suggested: text(200) })

const resultSchema = z
  .object({
    outcome: z.enum(OUTCOMES),
    type: z.enum(TYPES),
    reason: text(300),
    questions: z.array(question).min(1).max(5).optional(),
    duplicateOf: z.number().int().positive().optional(),
  })
  .superRefine((result, ctx) => {
    const asking = result.outcome === 'needs-info'
    if (asking !== (result.questions !== undefined)) {
      ctx.addIssue({ code: 'custom', path: ['questions'], message: 'give 1 to 5 questions exactly for needs-info' })
    }
    if ((result.outcome === 'duplicate') !== (result.duplicateOf !== undefined)) {
      ctx.addIssue({ code: 'custom', path: ['duplicateOf'], message: 'give the issue number exactly for duplicate' })
    }
  })

type Result = z.infer<typeof resultSchema>

const CLOSING = {
  duplicate: { reason: 'duplicate', forge: 'duplicate' },
  'not-planned': { reason: 'not-planned', forge: 'not_planned' },
  'not-a-bug': { reason: 'not-a-bug', forge: 'not_planned' },
} as const

const closing = (outcome: keyof typeof CLOSING, result: Result, autoClose: boolean): Applied => {
  const { reason, forge } = CLOSING[outcome]
  const cite = result.duplicateOf === undefined ? '' : ` of #${result.duplicateOf}`
  const effects: Effect[] = [{ kind: 'question', body: `Closing as ${outcome}${cite}: ${result.reason}` }]
  if (autoClose) effects.push({ kind: 'close', reason: forge })
  return { patch: { type: result.type }, events: [{ type: 'intake.closed', data: { reason } }], effects }
}

const answering = (result: Result, autoClose: boolean): Applied => {
  const effects: Effect[] = [{ kind: 'question', body: `Answer: ${result.reason}` }]
  if (autoClose) effects.push({ kind: 'close', reason: 'completed' })
  return { patch: { type: result.type }, events: [{ type: 'intake.closed', data: { reason: 'answered' } }], effects }
}

export const intake = defineModule({
  stage: 'intake',
  role: 'builder',
  writes: ['type'],
  resultSchema,
  apply: (_record, result, _run, { config, state }) => {
    const patch = { type: result.type }
    switch (result.outcome) {
      case 'accepted':
        if (result.type === 'question') return answering(result, config.autoClose)
        return { patch, events: [{ type: 'intake.accepted', data: {} }] }
      case 'disputed':
        return { patch, events: [{ type: 'intake.disputed', data: {} }] }
      case 'needs-info': {
        const round = state.reporter.rounds + 1
        const body = questionsBody(round, result.questions ?? [])
        return { patch, events: [{ type: 'intake.asked', data: { round } }], effects: [{ kind: 'question', body }] }
      }
      default:
        return closing(result.outcome, result, config.autoClose)
    }
  },
})
