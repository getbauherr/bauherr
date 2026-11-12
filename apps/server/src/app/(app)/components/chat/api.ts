import type { ThreadHistoryAdapter, ThreadMessage } from '@assistant-ui/react'

export type Meta = { id: number; title: string | null; archived: boolean; lastMessageAt: string | null; createdAt: string; context: { path: string; label: string } | null; ticket: number | null }
export type Pending = { toolCallId: string; name: string; kind: 'confirm'; input: unknown; summary: string; title: string; details: { label: string; value: string }[]; destructive: boolean; approve?: string; decline?: string; noReason?: boolean }
export type Answer = { model: string; tokensIn: number; tokensOut: number; costUsd: number | null; ms: number; toolCalls: { name: string; kind: string; ok: boolean }[] }
export type Stored = { parentId: string | null; message: ThreadMessage & { createdAt: string }; answer: Answer | null; feedback: { value: 'up' | 'down'; reasons: string[]; note: string | null } | null }
export type Loaded = { context: Meta['context']; ticket: number | null; pending: Pending | null; messages: Stored[] }
export type HistoryItem = Parameters<ThreadHistoryAdapter['append']>[0]

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export const jsonRequest = (method: string, body?: unknown): RequestInit => ({ method, ...(body !== undefined && { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) })

/** The server's `{error}` text of a failed answer. */
export const errorOf = async (r: Response): Promise<string> => ((await r.json().catch(() => ({}))) as { error?: string }).error ?? r.statusText

const call = async <T>(path: string, method = 'GET', body?: unknown): Promise<T> => {
  const r = await fetch(`/api/chat${path}`, jsonRequest(method, body))
  if (!r.ok) throw new ApiError(await errorOf(r), r.status)
  return (r.status === 204 ? undefined : await r.json()) as T
}

export const api = {
  list: () => call<{ threads: Meta[] }>('/threads').then((r) => r.threads),
  create: (path: string) => call<Meta>('/threads', 'POST', { path }),
  /** The person's one thread of a Ticket (created on first use). */
  ticketThread: (ticket: number) => call<Meta>('/threads', 'POST', { ticket }),
  fetch: (id: string) => call<Meta>(`/threads/${id}`),
  update: (id: string, patch: { title?: string | null; archived?: boolean }) => call<void>(`/threads/${id}`, 'PATCH', patch),
  remove: (id: string) => call<void>(`/threads/${id}`, 'DELETE'),
  messages: (id: string) => call<Loaded>(`/threads/${id}/messages`),
  putMessage: (id: string, item: HistoryItem, answerId?: string) => {
    const m = item.message
    // A `File` cannot be serialized; the uploaded image is addressed by the URL in the attachment content.
    const message = m.role === 'user' ? { ...m, attachments: m.attachments.map(({ file: _f, ...a }) => a) } : m
    return call<void>(`/threads/${id}/messages`, 'PUT', { parentId: item.parentId, message, ...(answerId && { answerId }) })
  },
  feedback: (id: string, body: { messageId: string; value: 'up' | 'down' | null; reasons?: string[]; note?: string }) => call<void>(`/threads/${id}/feedback`, 'POST', body),
  context: (path: string) => call<{ label: string; markdown: string }>(`/context?path=${encodeURIComponent(path)}`),
}

/** What the page behind the dock is: pathname and query, read when it is needed (the person navigates while the dock stays open). */
export const currentPath = (): string => location.pathname + location.search

export const remember = {
  get: (key: string): string | null => {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set: (key: string, value: string | null): void => {
    try {
      value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value)
    } catch {}
  },
}
