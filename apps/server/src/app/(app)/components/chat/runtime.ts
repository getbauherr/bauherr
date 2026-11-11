import { useCallback, useMemo, useRef, useState, type RefObject } from 'react'
import { useAui, useLocalRuntime, useRemoteThreadListRuntime, type FeedbackAdapter, type RemoteThreadListAdapter, type ThreadHistoryAdapter } from '@assistant-ui/react'
import { api, currentPath, remember, type HistoryItem, type Meta, type Pending, type Stored } from './api'
import { makeAttachments, makeChatAdapter, type Artifact, type Custom } from './adapter'

type Metadata = Awaited<ReturnType<RemoteThreadListAdapter['fetch']>>
type TitleStream = Awaited<ReturnType<RemoteThreadListAdapter['generateTitle']>>
type TitleChunk = TitleStream extends ReadableStream<infer C> ? C : never
type Item = { getState(): { remoteId?: string | undefined }; initialize(): Promise<{ remoteId: string }> }

export type Hooks = {
  /** A stored thread was opened: the page it was about (null for a new one). */
  onLoaded(threadId: string | undefined, context: Meta['context'], ticket: number | null): void
  onWrite(): void
}

const toMetadata = (t: Meta): Metadata => ({ remoteId: String(t.id), status: t.archived ? 'archived' : 'regular', title: t.title ?? undefined, lastMessageAt: t.lastMessageAt ? new Date(t.lastMessageAt) : undefined })

const remoteId = async (item: Item): Promise<string> => item.getState().remoteId ?? (await item.initialize()).remoteId

const titleStream = (title: string | undefined): TitleStream =>
  new ReadableStream<TitleChunk>({
    start(c) {
      if (title) {
        c.enqueue({ type: 'part-start', part: { type: 'text' }, path: [0] })
        c.enqueue({ type: 'text-delta', textDelta: title, path: [0] })
        c.enqueue({ type: 'part-finish', path: [0] })
      }
      c.close()
    },
  })

/** Saves in flight by message id, so a rating waits for the answer's row to carry the client's id. */
const writes = new Map<string, Promise<unknown>>()
const track = async (id: string, p: Promise<void>): Promise<void> => {
  const q = p.catch(() => {}).finally(() => writes.get(id) === q && writes.delete(id))
  writes.set(id, q)
  await p
}

const cardOf = (p: Pending) => ({
  type: 'tool-call' as const,
  toolCallId: p.toolCallId,
  toolName: p.name,
  args: (p.input ?? {}) as Record<string, never>,
  argsText: JSON.stringify(p.input ?? {}),
  artifact: { kind: 'confirm', summary: p.summary, title: p.title, details: p.details, destructive: p.destructive } satisfies Artifact,
})

/** A stored item as assistant-ui's exported repository item; the server's usage and rating win over what the client stored. A pending card the client never saved is put back. */
const decode = (s: Stored) => {
  const m = s.message
  const custom = (m.metadata?.custom ?? {}) as Custom
  return {
    parentId: s.parentId,
    message: {
      ...m,
      createdAt: new Date(m.createdAt),
      ...(m.role === 'assistant' && {
        metadata: {
          ...m.metadata,
          custom: { ...custom, ...(s.answer && { usage: { model: s.answer.model, tokensIn: s.answer.tokensIn, tokensOut: s.answer.tokensOut, costUsd: s.answer.costUsd, ms: s.answer.ms } }) },
          ...(s.feedback && { submittedFeedback: { type: s.feedback.value === 'up' ? 'positive' : 'negative' } }),
        },
      }),
    },
  } as HistoryItem
}

const withPending = (items: HistoryItem[], pending: Pending | null): HistoryItem[] => {
  if (!pending) return items
  const last = items.at(-1)?.message
  if (last?.role === 'assistant' && last.content.some((p) => p.type === 'tool-call' && p.toolCallId === pending.toolCallId)) return items
  const id = `pending-${pending.toolCallId}`
  const message = { id, role: 'assistant', createdAt: new Date(), content: [cardOf(pending)], status: { type: 'requires-action', reason: 'tool-calls' }, metadata: { unstable_state: null, unstable_annotations: [], unstable_data: [], steps: [], custom: {} } }
  return [...items, { parentId: last?.id ?? null, message } as HistoryItem]
}

const QUESTIONS = (ticket: number) => `questions-${ticket}`

/** A Ticket thread starts with the card of the owner's open questions (not stored; it loads them itself and hides when none are open); the first stored message hangs off it. */
const withQuestions = (items: HistoryItem[], ticket: number): HistoryItem[] => {
  const id = QUESTIONS(ticket)
  const part = { type: 'tool-call' as const, toolCallId: id, toolName: 'owner_questions', args: {}, argsText: '{}', artifact: { kind: 'questions', ticket } satisfies Artifact }
  const message = { id, role: 'assistant', createdAt: new Date(0), content: [part], status: { type: 'complete', reason: 'unknown' }, metadata: { unstable_state: null, unstable_annotations: [], unstable_data: [], steps: [], custom: { synthetic: true } } }
  return [{ parentId: null, message } as HistoryItem, ...items.map((i) => (i.parentId ? i : ({ ...i, parentId: id } as HistoryItem)))]
}

const listAdapter = (hooks: RefObject<Hooks>): RemoteThreadListAdapter => {
  const history = (item: () => Item): ThreadHistoryAdapter => ({
    async load() {
      const id = item().getState().remoteId
      if (!id) return { messages: [] }
      const d = await api.messages(id)
      hooks.current.onLoaded(id, d.context, d.ticket)
      const items = withPending(d.messages.map(decode), d.pending)
      return { messages: d.ticket ? withQuestions(items, d.ticket) : items }
    },
    append: async (entry) => {
      const id = await remoteId(item())
      return track(entry.message.id, api.putMessage(id, entry, (entry.message.metadata?.custom as Custom | undefined)?.answerId))
    },
    update: async (entry) => {
      const id = await remoteId(item())
      return track(entry.message.id, api.putMessage(id, entry, (entry.message.metadata?.custom as Custom | undefined)?.answerId))
    },
  })

  function useAdapters() {
    const aui = useAui()
    return useMemo(() => ({ history: history(() => aui.threadListItem) }), [aui])
  }

  return {
    list: async () => ({ threads: (await api.list()).map(toMetadata) }),
    fetch: async (id) => toMetadata(await api.fetch(id)),
    initialize: async () => ({ remoteId: String((await api.create(currentPath())).id), externalId: undefined }),
    rename: (id, title) => api.update(id, { title }),
    archive: (id) => api.update(id, { archived: true }),
    unarchive: (id) => api.update(id, { archived: false }),
    delete: (id) => api.remove(id),
    generateTitle: async (id) => titleStream((await api.fetch(id)).title ?? undefined),
    unstable_useAdapters: useAdapters,
  }
}

const attachments = makeAttachments()

/** Thread list over `/api/chat/threads`; per thread a local runtime whose adapter reads the NDJSON stream. */
export function useChatRuntime(hooks: Hooks, initialThreadId: string | undefined, userKey: string) {
  const ref = useRef(hooks)
  ref.current = hooks
  const [adapter] = useState(() => listAdapter(ref))

  const runtimeHook = useCallback(() => {
    const aui = useAui()
    const chat = useMemo(() => makeChatAdapter({ threadId: () => remoteId(aui.threadListItem), onWrite: () => ref.current.onWrite() }), [aui])
    const feedback = useMemo<FeedbackAdapter>(
      () => ({
        submit: async ({ message, type, comment }) => {
          const id = await remoteId(aui.threadListItem)
          await writes.get(message.id)
          const { reasons, note } = comment ? (JSON.parse(comment) as { reasons?: string[]; note?: string }) : {}
          await api.feedback(id, { messageId: message.id, value: type === 'positive' ? 'up' : 'down', reasons, note }).catch(() => {})
        },
      }),
      [aui],
    )
    return useLocalRuntime(chat, { adapters: { attachments, feedback } })
  }, [])

  const runtime = useRemoteThreadListRuntime({
    runtimeHook,
    adapter,
    initialThreadId,
    onThreadIdChange: (id) => {
      remember.set(userKey, id ?? null)
      if (!id) ref.current.onLoaded(undefined, null, null)
    },
  })
  return runtime
}
