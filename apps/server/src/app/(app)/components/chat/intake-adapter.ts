import { checkImage, MEDIA_TYPES } from '../../../../lib/intake/media-check'
import { generateId, type AttachmentAdapter, type ChatModelAdapter, type ThreadMessageLike } from '@assistant-ui/react'

export type Draft = { problem: string; context: string; acceptance_criteria: string[] }
export type Turn = { question: string; options?: { label: string; recommended?: boolean }[]; draft: Draft; split?: Draft[]; ready: boolean; exhausted: boolean }

type Config = {
  /** `''` on the signed-in page (cookie), the Bauherr origin in the widget. */
  base: string
  /** `authorization: Bearer <embed token>` in the widget. */
  headers?: Record<string, string>
  product?: () => number
  /** An already open session to continue. */
  session?: string | null
  onSession(id: string): void
  onTurn(turn: Turn): void
}

/** A persisted conversation as thread messages; the open `turn` rides on the last assistant message. */
export function toMessages(messages: { role: string; content: string }[], turn: object | null): ThreadMessageLike[] {
  return messages.map((m, i) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: [{ type: 'text', text: m.content }],
    ...(turn && i === messages.length - 1 && m.role !== 'user' ? { metadata: { custom: { turn } } } : {}),
  }))
}

/** The Intake API as assistant-ui adapters. The session starts with the first message or screenshot. */
export function makeIntakeAdapter({ base, headers = {}, product, session: open = null, onSession, onTurn }: Config) {
  let session = open
  const media = new Map<string, string>()
  const post = (path: string, body?: BodyInit | object, signal?: AbortSignal) =>
    fetch(`${base}/intake/api/${path}`, body instanceof FormData ? { method: 'POST', headers, body, signal } : { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}), signal })

  let limits: Promise<number | null> | undefined
  const maxBytes = () => (limits ??= post('media-limits').then(async (r) => (r.ok ? ((await r.json()) as { maxBytes: number }).maxBytes : null)).catch(() => null))

  const ensure = async (): Promise<string> => {
    if (session) return session
    const r = await post('sessions', { product: product?.() })
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Could not start the request')
    session = String(((await r.json()) as { id: number }).id)
    onSession(session)
    return session
  }

  const chatModel: ChatModelAdapter = {
    async run({ messages, abortSignal }) {
      const last = messages.at(-1)!
      const text = last.content.map((p) => (p.type === 'text' ? p.text : '')).join('')
      const images = (last.attachments ?? []).map((a) => media.get(a.id)).filter(Boolean)
      const id = await ensure()
      const body = await (await post(`sessions/${id}/messages`, { text, images }, abortSignal)).text()
      const ev = body.split('\n\n').find((e) => e.trim())?.split('\n') ?? []
      const data = JSON.parse(ev.find((l) => l.startsWith('data: '))?.slice(6) ?? '{}')
      if (ev[0] === 'event: error' || !data.question) throw new Error(data.message ?? 'No answer from the model')
      onTurn(data)
      return { content: [{ type: 'text', text: data.question }], metadata: { custom: { turn: data } } }
    },
  }

  const attachments: AttachmentAdapter = {
    accept: MEDIA_TYPES.join(','),
    async *add({ file }) {
      const pending = { id: generateId(), type: 'image', name: file.name, contentType: file.type, file } as const
      yield { ...pending, status: { type: 'running', reason: 'uploading', progress: 0 } }
      try {
        const max = await maxBytes()
        const bad = max === null ? null : checkImage(file, max)
        if (bad) throw new Error(bad)
        const form = new FormData()
        form.append('file', file)
        const r = await post(`sessions/${await ensure()}/screenshots`, form)
        const data = (await r.json().catch(() => ({}))) as { id?: number; error?: string }
        if (!r.ok || !data.id) throw new Error(data.error ?? 'Could not upload the screenshot')
        media.set(pending.id, String(data.id))
        yield { ...pending, status: { type: 'requires-action', reason: 'composer-send' } }
      } catch (e) {
        yield { ...pending, status: { type: 'incomplete', reason: 'error', message: e instanceof Error ? e.message : String(e) } }
      }
    },
    send: async (a) => ({ ...a, status: { type: 'complete' }, content: [] }),
    remove: async () => {},
  }

  return { chatModel, attachments }
}
