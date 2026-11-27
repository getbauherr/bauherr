import type { DecisionModel, DecisionOption } from './inbox-decision'
import { RECEIPTS } from './inbox-words'

export type FormState = { note: string; ticked: string[]; answers: Record<string, string> }

export type DecideInput = {
  recordId: number
  ask: string
  seq: number
  choice: string
  note?: string
  answers?: Record<string, string>
  criteria?: string[]
}

export const initialForm = (model: DecisionModel): FormState => ({
  note: '',
  ticked: model.criteria?.suggested ?? [],
  answers: Object.fromEntries(model.answers.map((answer) => [answer.id, answer.recommended])),
})

export const receiptOf = (option: DecisionOption, ticked: string[]): string =>
  option.criteria ? `Dropped ${ticked.join(', ')}` : (RECEIPTS[option.choice] ?? option.label)

export const canConfirm = (option: DecisionOption, form: FormState): boolean => {
  if (option.criteria) return form.ticked.length > 0
  return !option.note?.required || form.note.trim() !== ''
}

export const inputOf = (model: DecisionModel, option: DecisionOption, form: FormState): DecideInput => {
  const note = form.note.trim()
  const approving = model.ask === 'brief' && option.choice === 'approve'
  return {
    recordId: model.recordId,
    ask: model.ask,
    seq: model.seq,
    choice: option.choice,
    ...(option.note && note !== '' ? { note } : {}),
    ...(approving && model.answers.length > 0 ? { answers: form.answers } : {}),
    ...(option.criteria ? { criteria: form.ticked } : {}),
  }
}
