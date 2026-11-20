import type { Conn } from './conn'
import { patchRecord } from './record/store'
import type { Decision as OpenDecision, TicketRecord } from './record/schema'
import { storeStatement, STATEMENT_MAX } from './statements'

export type Answers = Record<string, string>

const withAnswer = (decision: OpenDecision, option: string, now: Date): OpenDecision => ({
  ...decision,
  answer: option,
  by: 'owner',
  at: now.toISOString(),
})

export const answersProblem = (record: TicketRecord, answers: Answers): string | null => {
  const open = record.decisions.filter((d) => d.answer === undefined)
  const unknown = Object.keys(answers).filter((id) => !open.some((d) => d.id === id))
  if (unknown.length > 0) {
    return `${unknown.join(', ')} is not an open decision of this Brief: answer only its open decisions.`
  }
  for (const decision of open) {
    const given = answers[decision.id]
    if (given === undefined) return `Decision ${decision.id} is open: answer it with one of its options.`
    if (!decision.options.some((o) => o.id === given)) {
      return `${given} is not an option of ${decision.id}: pick one of its options.`
    }
  }
  return null
}

export const storeAnswers = async (
  tx: Conn,
  recordId: number,
  stored: { version: number; record: TicketRecord },
  answers: Answers,
  now: Date,
): Promise<void> => {
  const decisions = stored.record.decisions.map((d) => {
    const given = answers[d.id]
    return given === undefined ? d : withAnswer(d, given, now)
  })
  await patchRecord(tx, recordId, {
    expectedVersion: stored.version,
    writes: ['decisions'],
    patch: { decisions },
    by: { stage: 'brief', runId: 'owner' },
  })
  for (const d of stored.record.decisions) {
    const given = answers[d.id]
    const label = d.options.find((o) => o.id === given)?.label
    if (label !== undefined) {
      await storeStatement(tx, recordId, { kind: 'answer', text: `${d.question}: ${label}`.slice(0, STATEMENT_MAX) })
    }
  }
}
