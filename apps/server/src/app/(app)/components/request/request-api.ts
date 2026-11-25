import { z } from 'zod'
import type { ConversationEntry } from '../conversation/conversation-api'
import type { DraftView } from '../../../../core/requests/view'

const failure = z.object({ error: z.string() })
const state = z.object({ messages: z.custom<ConversationEntry[]>(), draft: z.custom<DraftView | null>() })

export type RequestState = z.infer<typeof state>
export type RequestAction =
  | { action: 'message'; text: string; fileIds: number[] }
  | { action: 'type'; type: 'bug' | 'change' | 'question' | 'chore' }
  | { action: 'send' | 'join' | 'close' }

const parsed = async <T extends z.ZodType>(res: Response, schema: T): Promise<z.infer<T>> => {
  const body: unknown = await res.json().catch(() => null)
  const refused = failure.safeParse(body).data?.error ?? `The factory refused the request (${res.status}).`
  if (!res.ok) throw new Error(refused)
  return schema.parse(body)
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const requestApi = () => ({
  create: async (workspace: number, product: number): Promise<number> =>
    (await parsed(await fetch('/api/requests', json({ workspace, product })), z.object({ id: z.number() }))).id,
  state: async (id: number): Promise<RequestState> => parsed(await fetch(`/api/requests/${id}`), state),
  act: async (id: number, body: RequestAction): Promise<RequestState> =>
    parsed(await fetch(`/api/requests/${id}`, json(body)), state),
})

export type RequestApi = ReturnType<typeof requestApi>
