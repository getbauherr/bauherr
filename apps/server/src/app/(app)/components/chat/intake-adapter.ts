import { generateId, type AttachmentAdapter, type ChatModelAdapter } from '@assistant-ui/react'

export type Draft = { problem: string; context: string; acceptance_criteria: string[] }
export type Turn = { question: string; options?: { label: string; recommended?: boolean }[]; draft: Draft; ready: boolean; exhausted: boolean }

type Config = {
  /** `''` on the signed-in page (cookie), the Bauherr origin in the widget. */
  base: string
  /** `authorization: Bearer <embed token>` in the widget. */
  headers?: Record<string, string>
  product?: () => number
  onSession(id: string): void
  onTurn(turn: Turn): void
}

/** The Intake API as assistant-ui adapters. The session starts with the first message or screenshot. */
export function makeIntakeAdapter({ base, headers = {}, product, onSession, onTurn }: Config) {
  let session: string | null = null
  const media = new Map<string, string>()
  const post = (path: string, body?: BodyInit | object, signal?: AbortSignal) =>
    fetch(`${base}/intake/api/${path}`, body instanceof FormData ? { method: 'POST', headers, body, signal } : { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}), signal })

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
    accept: 'image/png,image/jpeg,image/webp',
    async *add({ file }) {
      const pending = { id: generateId(), type: 'image', name: file.name, contentType: file.type, file } as const
      yield { ...pending, status: { type: 'running', reason: 'uploading', progress: 0 } }
      try {
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
