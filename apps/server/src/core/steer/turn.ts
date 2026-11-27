import type { Payload } from 'payload'
import { appendMessage, listMessages, type ConversationMessage } from '../conversations/store'
import type { ChatTurn, RetroModel } from '../retro/model'
import { ticket } from '../views/ticket'
import { systemOf } from './context'
import { intentOf, type DecideIntent } from './intent'
import { parseReply } from './reply'
import { steerConversation } from './store'

const HISTORY = 6

export const UNDONE_NOTE = '*Undone. Nothing was written.*'

export const FALLBACK_NOTE = 'The factory model is not available, so your words went to the ticket as a comment.'

export type SteerDeps = { model: RetroModel; comment: (text: string) => Promise<string | null> }
export type SteerInput = { workspace: number; recordId: number; text: string }
export type SteerOutcome =
  | { kind: 'answer' }
  | { kind: 'fallback'; error: string | null }
  | { kind: 'comment'; body: string }
  | { kind: 'decide'; input: DecideIntent }

export const turnsOf = (history: ConversationMessage[], text: string): ChatTurn[] => {
  const recent = history.slice(-HISTORY).map(({ role, text: said }): ChatTurn => ({ role, content: said }))
  const all: ChatTurn[] = [...recent, { role: 'user', content: text }]
  const merged: ChatTurn[] = []
  for (const turn of all.slice(all.findIndex((candidate) => candidate.role === 'user'))) {
    const last = merged.at(-1)
    if (last?.role === turn.role) last.content = `${last.content}\n${turn.content}`
    else merged.push({ ...turn })
  }
  return merged
}

const store = async (payload: Payload, input: SteerInput, conversationId: number, texts: string[]) => {
  const message = { workspace: input.workspace, conversationId, fileIds: [] }
  await payload.db.drizzle.transaction(async (tx) => {
    const db = { db: { drizzle: tx } }
    await appendMessage(db, { ...message, role: 'user', text: input.text })
    for (const text of texts) await appendMessage(db, { ...message, role: 'assistant', text })
  })
}

const fallback = async (payload: Payload, deps: SteerDeps, input: SteerInput, id: number): Promise<SteerOutcome> => {
  const error = await deps.comment(input.text)
  if (error === null) {
    const note = { workspace: input.workspace, conversationId: id, role: 'assistant' as const, fileIds: [] }
    await appendMessage(payload, { ...note, text: FALLBACK_NOTE })
  }
  return { kind: 'fallback', error }
}

export const steerTurn = async (payload: Payload, deps: SteerDeps, input: SteerInput): Promise<SteerOutcome> => {
  const { workspace, recordId } = input
  const view = await ticket(payload, { workspace, recordId })
  const conversationId = await steerConversation(payload, workspace, recordId)
  const turns = turnsOf(await listMessages(payload, conversationId), input.text)
  let raw: string
  try {
    raw = await deps.model(workspace, systemOf(view), turns)
  } catch {
    return fallback(payload, deps, input, conversationId)
  }
  const intent = intentOf(view, parseReply(raw))
  await store(payload, input, conversationId, [intent.text])
  if (intent.kind === 'decide') return { kind: 'decide', input: intent.input }
  return intent.kind === 'comment' ? { kind: 'comment', body: intent.body } : { kind: 'answer' }
}
