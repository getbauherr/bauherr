import type { Payload } from 'payload'
import type { RecordType } from '../record/schema'
import { appendMessage, listMessages } from '../conversations/store'
import type { ChatTurn, RetroModel } from '../retro/model'
import { RequestError, RequestInvalid } from './errors'
import { fieldKeys, MAX_ROUNDS, readiness, type Fields } from './fields'
import { acceptRound, problemFirst, stillMissing } from './questions'
import { contextOf, parseReply, RETRY_LINE, type ModelReply } from './reply'
import { similarOpen, type SimilarRequest } from './similar'
import { loadDraft, saveDraft, type Draft, type DraftData } from './store'

export type RequestModel = RetroModel
export type TurnDeps = {
  model: RequestModel
  skill: () => Promise<string>
  similar?: (where: { workspace: number; product: number }, text: string) => Promise<SimilarRequest | null>
}
export type Turn = { conversationId: number; text: string; fileIds: number[] }

const OUT_OF_QUESTIONS =
  ' I have asked all the rounds I may: the card on the right lists what is still missing, ' +
  'and you can add it in your own words.'

const turnsOf = async (payload: Payload, conversationId: number): Promise<ChatTurn[]> =>
  (await listMessages(payload, conversationId)).map((message) => ({
    role: message.role,
    content:
      message.files.length === 0
        ? message.text
        : `${message.text}\n[attached: ${message.files.map((file) => file.name).join(', ')}]`,
  }))

type Asked = { reply: ModelReply; refused: boolean }

const checked = (rounds: number, reply: ModelReply): Asked => {
  if (rounds >= MAX_ROUNDS && reply.questions.length > 0) return { reply, refused: true }
  acceptRound(rounds, reply.questions)
  return { reply, refused: false }
}

const ask = async (deps: TurnDeps, workspace: number, data: DraftData, turns: ChatTurn[]): Promise<Asked> => {
  const system = `${await deps.skill()}\n\n## The draft now\n\n${contextOf(data)}`
  const raw = await deps.model(workspace, system, turns)
  try {
    return checked(data.rounds, parseReply(raw))
  } catch (error) {
    if (!(error instanceof RequestError)) throw error
    const retry: ChatTurn[] = [
      ...turns,
      { role: 'assistant', content: raw },
      { role: 'user', content: RETRY_LINE },
    ]
    return checked(data.rounds, parseReply(await deps.model(workspace, system, retry)))
  }
}

const mergedFields = (type: RecordType, before: Fields, reply: ModelReply): Fields => {
  const fields: Fields = { ...before }
  for (const key of fieldKeys(type)) {
    const value = reply.fields[key]?.trim()
    if (value) fields[key] = value
  }
  return fields
}

const answerOf = (type: RecordType, reply: ModelReply): string | null =>
  type === 'question' ? (reply.answer ?? reply.reply) : null

const apply = (data: DraftData, reply: ModelReply, refused: boolean): { data: DraftData; message: string } => {
  const type = data.typeConfirmed && data.type ? data.type : reply.type
  const fields = mergedFields(type, data.fields, reply)
  const missing = stillMissing(type, fields, reply.questions)
  const asked = refused ? [] : problemFirst(type, fields, data.rounds, missing)
  const confirm = data.type !== type && reply.confirm ? `${reply.confirm}\n\n` : ''
  const closing = refused && !readiness(type, fields).complete ? OUT_OF_QUESTIONS : ''
  const next = { type, fields, questions: asked, rounds: data.rounds + Math.min(asked.length, 1) }
  const title = { title: reply.title || data.title, summary: reply.summary || data.summary }
  return {
    message: `${confirm}${reply.reply}${closing}`,
    data: { ...data, ...next, ...title, answer: answerOf(type, reply) },
  }
}

const offerText = (similar: SimilarRequest): string =>
  `This looks like the open request "${similar.title}" (#${similar.number}). ` +
  'Do you want to join it instead of sending a new request? Say what you need if it is different.'

const offerSimilar = async (payload: Payload, deps: TurnDeps, draft: Draft): Promise<boolean> => {
  const find = deps.similar ?? ((where, text) => similarOpen(payload, where, text))
  const said = (await turnsOf(payload, draft.conversationId)).filter((turn) => turn.role === 'user')
  const where = { workspace: draft.workspace, product: draft.product }
  const similar = await find(where, said.map((turn) => turn.content).join('\n'))
  const data = { ...draft.data, questions: [], offered: true, offer: similar }
  await saveDraft(payload, draft.conversationId, { data })
  if (!similar) return false
  const message = { workspace: draft.workspace, conversationId: draft.conversationId, fileIds: [] }
  await appendMessage(payload, { ...message, role: 'assistant', text: offerText(similar) })
  return true
}

export const takeTurn = async (payload: Payload, deps: TurnDeps, input: Turn): Promise<void> => {
  const draft = await loadDraft(payload, input.conversationId)
  if (!draft) throw new RequestInvalid('This request does not exist.')
  if (draft.state !== 'open') throw new RequestInvalid('This request is closed: start a new one.')
  const { workspace, conversationId } = draft
  await payload.db.drizzle.transaction(async (tx) => {
    await appendMessage({ db: { drizzle: tx } }, { ...input, workspace, role: 'user' })
  })
  const first = !draft.data.offered && draft.data.rounds === 0
  if (first && (await offerSimilar(payload, deps, draft))) return
  const data = { ...draft.data, questions: [], offered: true }
  const { reply, refused } = await ask(deps, workspace, data, await turnsOf(payload, conversationId))
  const applied = apply(data, reply, refused)
  await appendMessage(payload, { workspace, conversationId, role: 'assistant', text: applied.message, fileIds: [] })
  await saveDraft(payload, conversationId, { data: applied.data })
}
