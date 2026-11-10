import type { Payload } from 'payload'
import { textOf, type Answer } from './threads'

type Doc = Record<string, any>
export type RatedAnswer = {
  messageId: string
  threadId: number
  value: 'up' | 'down'
  reasons: string[]
  note: string | null
  at: string
  rater: string | null
  question: string
  answer: string
  tools: Answer['toolCalls']
  usage: Pick<Answer, 'model' | 'tokensIn' | 'tokensOut' | 'costUsd' | 'ms'> | null
}

const EXCERPT_CHARS = 500
const cut = (s: string) => (s.length > EXCERPT_CHARS ? `${s.slice(0, EXCERPT_CHARS)}…` : s)

/** Rated answers of a Workspace, newest rating first: the question, an excerpt of the answer, tools used, usage, thread and rater. */
export const chatFeedback = async (payload: Payload, workspace: number | string, { limit = 50 }: { limit?: number } = {}): Promise<RatedAnswer[]> => {
  const q = { overrideAccess: true } as const
  const { docs } = await payload.find({ collection: 'chat_messages', where: { and: [{ workspace: { equals: workspace } }, { feedback: { exists: true } }] }, sort: '-feedbackAt', limit: Math.min(Math.max(limit, 1), 200), depth: 2, ...q })
  return Promise.all(
    (docs as Doc[]).map(async (m): Promise<RatedAnswer> => {
      const parent = m.parentId ? ((await payload.find({ collection: 'chat_messages', where: { and: [{ thread: { equals: m.thread.id } }, { messageId: { equals: m.parentId } }] }, limit: 1, depth: 0, ...q })).docs[0] as Doc | undefined) : undefined
      const { toolCalls = [], ...usage } = (m.answer ?? {}) as Partial<Answer>
      return {
        messageId: m.messageId,
        threadId: m.thread.id,
        value: m.feedback,
        reasons: m.feedbackReasons ?? [],
        note: m.feedbackNote ?? null,
        at: m.feedbackAt,
        rater: m.thread.owner?.email ?? null,
        question: cut(textOf(parent?.message)),
        answer: cut(textOf(m.message)),
        tools: toolCalls,
        usage: m.answer ? (usage as RatedAnswer['usage']) : null,
      }
    }),
  )
}
