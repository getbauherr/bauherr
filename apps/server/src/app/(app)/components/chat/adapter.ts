import { generateId, type AttachmentAdapter, type ChatModelAdapter, type ChatModelRunResult, type ThreadAssistantMessagePart, type ThreadMessage } from '@assistant-ui/react'
import { errorOf, currentPath, jsonRequest } from './api'
import { MEDIA_TYPES } from '../../../../lib/intake/media-check'

type Part = ThreadAssistantMessagePart
type Tool = Extract<Part, { type: 'tool-call' }>
type Json = Tool['args']
type Detail = { label: string; value: string }

/** Read from `part.artifact`, set by the adapter from the stream: the widget is picked by `kind`, never by tool name. */
export type Artifact =
  | { kind: 'read'; summary: string }
  | { kind: 'confirm'; summary: string; title?: string; details?: Detail[]; destructive?: boolean }
  | { kind: 'outcome' }
export type Decision = { approved: boolean; reason?: string }
export type Outcome = { ok: boolean; text: string }
export type Usage = { model: string; tokensIn: number; tokensOut: number; costUsd: number | null; ms: number }
export type Custom = { answerId?: string; usage?: Usage }

type Ev =
  | { type: 'context'; label: string }
  | { type: 'delta'; text: string }
  | { type: 'tool-call'; id: string; name: string; kind: 'read' | 'confirm'; input: Json; summary: string }
  | { type: 'tool-result'; id: string; ok: boolean; result: string }
  | { type: 'confirm'; id: string; name: string; title: string; details: Detail[]; destructive: boolean }
  | { type: 'done'; answerId: string; requiresAction?: boolean; usage: Usage }
  | { type: 'error'; message: string }

const OUTCOME = ':outcome'
export const artifactOf = (p: { artifact?: unknown }): Artifact | undefined => p.artifact as Artifact | undefined
const mediaIdOf = (url: unknown): number | null => {
  const m = /\/m\/(\d+)\//.exec(String(url))
  return m ? Number(m[1]) : null
}

type Wire = { role: 'user' | 'assistant'; content: ({ type: 'text'; text: string } | { type: 'image'; mediaId: number })[] }
/** The visible history, text and images only. */
export const toWire = (messages: readonly ThreadMessage[]): Wire[] =>
  messages.flatMap((m): Wire[] => {
    if (m.role !== 'user' && m.role !== 'assistant') return []
    const parts = [...m.content, ...(m.role === 'user' ? (m.attachments ?? []).flatMap((a) => a.content) : [])]
    const content = parts.flatMap((p): Wire['content'] => {
      if (p.type === 'text') return p.text.trim() ? [{ type: 'text', text: p.text }] : []
      const id = p.type === 'image' ? mediaIdOf(p.image) : null
      return id ? [{ type: 'image', mediaId: id }] : []
    })
    return content.length ? [{ role: m.role, content }] : []
  })

async function* lines(res: Response): AsyncGenerator<Ev> {
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const rows = buf.split('\n')
    buf = rows.pop() ?? ''
    for (const row of rows) if (row.trim()) yield JSON.parse(row) as Ev
  }
}

type Options = {
  /** The thread's server id; a thread nobody wrote to yet is created first. */
  threadId: () => Promise<string>
  /** A run or confirmation changed what the page behind the dock shows. */
  onWrite: () => void
}

/** The one answer message, turned into parts as events arrive; a continuation (confirm) appends to the message the card sits in. */
export function makeChatAdapter({ threadId, onWrite }: Options): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal, unstable_getMessage }): AsyncGenerator<ChatModelRunResult> {
      const id = await threadId()
      const current = unstable_getMessage()
      const decided = current.content.find((p): p is Tool => p.type === 'tool-call' && artifactOf(p)?.kind === 'confirm' && p.result !== undefined && !current.content.some((o) => o.type === 'tool-call' && o.toolCallId === p.toolCallId + OUTCOME))
      let res: Response
      if (decided) {
        const d = decided.result as Decision
        res = await fetch(`/api/chat/threads/${id}/confirm`, { ...jsonRequest('POST', { toolCallId: decided.toolCallId, approved: d.approved, reason: d.reason }), signal: abortSignal })
      } else {
        res = await fetch(`/api/chat/threads/${id}/run`, { ...jsonRequest('POST', { messages: toWire(messages), context: { path: currentPath() } }), signal: abortSignal })
      }
      const parts: Part[] = []
      let custom: Custom = {}
      const out = (extra?: Partial<ChatModelRunResult>): ChatModelRunResult => ({ content: [...parts], metadata: { custom }, ...extra })
      if (decided && res.status === 409) {
        parts.push(outcome(decided, { ok: false, text: 'Already decided.' }))
        yield out()
        return
      }
      if (!res.ok || !res.body) throw new Error(await errorOf(res))
      const tool = (toolCallId: string) => parts.find((p): p is Tool => p.type === 'tool-call' && p.toolCallId === toolCallId)
      const set = (p: Tool, patch: Partial<Tool>) => parts.splice(parts.indexOf(p), 1, { ...p, ...patch })
      for await (const ev of lines(res)) {
        if (ev.type === 'error') throw new Error(ev.message)
        if (ev.type === 'delta') {
          const last = parts.at(-1)
          if (last?.type === 'text') parts[parts.length - 1] = { ...last, text: last.text + ev.text }
          else parts.push({ type: 'text', text: ev.text })
        } else if (ev.type === 'tool-call') {
          parts.push({ type: 'tool-call', toolCallId: ev.id, toolName: ev.name, args: ev.input, argsText: JSON.stringify(ev.input), artifact: { kind: ev.kind, summary: ev.summary } satisfies Artifact })
        } else if (ev.type === 'tool-result') {
          const p = tool(ev.id)
          if (decided && ev.id === decided.toolCallId) {
            parts.push(outcome(decided, { ok: ev.ok, text: ev.result }))
            if (ev.ok) onWrite()
          } else if (p) set(p, { result: { ok: ev.ok, text: ev.result } satisfies Outcome })
        } else if (ev.type === 'confirm') {
          const p = tool(ev.id)
          if (p) set(p, { artifact: { kind: 'confirm', summary: (p.artifact as Artifact & { summary: string }).summary, title: ev.title, details: ev.details, destructive: ev.destructive } satisfies Artifact })
        } else if (ev.type === 'done') {
          custom = { answerId: ev.answerId, usage: ev.usage }
          yield out(ev.requiresAction ? { status: { type: 'requires-action', reason: 'tool-calls' } } : undefined)
          return
        }
        yield out()
      }
    },
  }
}

const outcome = (card: Tool, o: Outcome): Tool => ({ type: 'tool-call', toolCallId: card.toolCallId + OUTCOME, toolName: card.toolName, args: {}, argsText: '', artifact: { kind: 'outcome' } satisfies Artifact, result: o })

/** Uploads each image to `/api/chat/media` and sends it as an image part whose URL carries the media id. */
export const makeAttachments = (): AttachmentAdapter => ({
  accept: MEDIA_TYPES.join(','),
  async *add({ file }) {
    const base = { id: generateId(), type: 'image', name: file.name || 'screenshot', contentType: file.type, file } as const
    yield { ...base, status: { type: 'running', reason: 'uploading', progress: 0 } }
    try {
      const form = new FormData()
      form.append('file', file)
      const r = await fetch('/api/chat/media', { method: 'POST', body: form })
      const data = (await r.json().catch(() => ({}))) as { id?: number; url?: string; error?: string }
      if (!r.ok || !data.url) throw new Error(data.error ?? 'Could not upload the image')
      yield { ...base, content: [{ type: 'image', image: data.url }], status: { type: 'requires-action', reason: 'composer-send' } }
    } catch (e) {
      yield { ...base, status: { type: 'incomplete', reason: 'error', message: e instanceof Error ? e.message : String(e) } }
    }
  },
  send: async (a) => ({ ...a, status: { type: 'complete' }, content: a.content ?? [] }),
  remove: async () => {},
})
