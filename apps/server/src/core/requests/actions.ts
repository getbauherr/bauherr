import type { Payload } from 'payload'
import { RequestInvalid } from './errors'
import { loadDraft, saveDraft, type Draft } from './store'
import type { RecordType } from '../record/schema'

const openDraft = async (payload: Payload, conversationId: number): Promise<Draft> => {
  const draft = await loadDraft(payload, conversationId)
  if (!draft) throw new RequestInvalid('This request does not exist.')
  if (draft.state !== 'open') throw new RequestInvalid('This request is already finished.')
  return draft
}

export const joinExisting = async (payload: Payload, conversationId: number): Promise<void> => {
  const draft = await openDraft(payload, conversationId)
  if (!draft.data.offer) throw new RequestInvalid('There is no open request to join.')
  await saveDraft(payload, conversationId, { state: 'joined', data: { ...draft.data, joined: draft.data.offer } })
}

export const closeRequest = async (payload: Payload, conversationId: number): Promise<void> => {
  await openDraft(payload, conversationId)
  await saveDraft(payload, conversationId, { state: 'closed' })
}

export const chooseType = async (payload: Payload, conversationId: number, type: RecordType): Promise<void> => {
  const draft = await openDraft(payload, conversationId)
  await saveDraft(payload, conversationId, {
    data: { ...draft.data, type, typeConfirmed: true, answer: null, questions: [] },
  })
}
