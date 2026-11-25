import type { Conn } from '../conn'
import { FIELDS, readiness, TYPE_WORDS } from './fields'
import type { RequestQuestion } from './questions'
import { filesOf, loadDraft, type DraftFile, type DraftState } from './store'

export type DraftView = {
  state: DraftState
  type: string | null
  typeWord: string
  title: string
  fields: { key: string; label: string; value: string }[]
  missing: string[]
  complete: boolean
  questions: RequestQuestion[]
  files: DraftFile[]
  offer: { number: number; title: string; url: string } | null
  joined: { number: number; title: string; url: string } | null
  answer: string | null
  issueNumber: number | null
  rounds: number
}

export const draftView = async (db: Conn, conversationId: number): Promise<DraftView | null> => {
  const draft = await loadDraft(db, conversationId)
  if (!draft) return null
  const { data } = draft
  const specs = data.type === null ? [] : FIELDS[data.type]
  const ready = data.type === null ? null : readiness(data.type, data.fields)
  return {
    state: draft.state,
    type: data.type,
    typeWord: data.type === null ? '' : TYPE_WORDS[data.type],
    title: data.title,
    fields: specs.map((spec) => ({ key: spec.key, label: spec.label, value: data.fields[spec.key] ?? '' })),
    missing: ready?.missing.map((m) => m.label) ?? [],
    complete: ready?.complete ?? false,
    questions: data.questions,
    files: await filesOf(db, conversationId),
    offer: data.offer,
    joined: data.joined,
    answer: data.answer,
    issueNumber: draft.issueNumber,
    rounds: data.rounds,
  }
}
