import { z } from 'zod'

const file = z.object({ id: z.number(), name: z.string(), contentType: z.string(), bytes: z.number() })
const message = z.object({
  id: z.number(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  createdAt: z.string(),
  files: z.array(file),
})

export type ConversationFile = z.infer<typeof file>
export type ConversationEntry = z.infer<typeof message>
export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

const failure = z.object({ error: z.string() })

const parsed = async <T extends z.ZodType>(res: Response, schema: T): Promise<z.infer<T>> => {
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(failure.safeParse(body).data?.error ?? `The factory refused the request (${res.status}).`)
  }
  return schema.parse(body)
}

export const fileUrl = (conversationId: number, fileId: number): string =>
  `/api/conversations/${conversationId}/files/${fileId}`

export const conversationApi = (fetcher: Fetcher = (input, init) => fetch(input, init)) => ({
  create: async (workspace: number | undefined, title: string, recordId?: number): Promise<number> => {
    const res = await fetcher('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace, title, recordId }),
    })
    return (await parsed(res, z.object({ id: z.number() }))).id
  },
  messages: async (conversationId: number): Promise<ConversationEntry[]> => {
    const res = await fetcher(`/api/conversations/${conversationId}`)
    return (await parsed(res, z.object({ messages: z.array(message) }))).messages
  },
  send: async (conversationId: number, text: string, fileIds: number[]): Promise<number> => {
    const res = await fetcher(`/api/conversations/${conversationId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, fileIds }),
    })
    return (await parsed(res, z.object({ id: z.number() }))).id
  },
  upload: async (conversationId: number, upload: File): Promise<ConversationFile> => {
    const res = await fetcher(`/api/conversations/${conversationId}/files`, {
      method: 'POST',
      headers: { 'Content-Type': upload.type, 'X-File-Name': encodeURIComponent(upload.name) },
      body: upload,
    })
    return parsed(res, file)
  },
})

export type ConversationApi = ReturnType<typeof conversationApi>
