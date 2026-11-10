/**
 * Embeddable Intake chat, built to public/intake/widget.js (scripts/build-widget.ts).
 * Usage: `<script src="https://HOST/intake/widget.js" data-token="bemb_..."></script>`.
 */
import { AssistantRuntimeProvider, useLocalRuntime } from '@assistant-ui/react'
import css from 'widget:css'
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { makeIntakeAdapter, toMessages, type Turn } from '@/components/chat/intake-adapter'
import { ChatThread } from '@/components/chat/thread'
import { Button } from '@/components/ui/button'

type Saved = { id: string; messages: { role: string; content: string }[]; turn: Turn | null }

/** The session id lives in localStorage per token, so an open interview survives a page load. */
const slot = (token: string) => `bauherr-intake:${token.slice(0, 16)}`
const keep = (token: string, id: string | null) => {
  try {
    id === null ? localStorage.removeItem(slot(token)) : localStorage.setItem(slot(token), id)
  } catch {}
}

function Widget({ base, token, saved }: { base: string; token: string; saved: Saved | null }) {
  const [open, setOpen] = useState(false)
  const [turn, setTurn] = useState<Turn | null>(saved?.turn ?? null)
  const [sent, setSent] = useState<number[] | null>(null)
  const [error, setError] = useState('')
  const [session, setSession] = useState<string | null>(saved?.id ?? null)
  const [adapter] = useState(() => makeIntakeAdapter({ base, headers: { authorization: `Bearer ${token}` }, session: saved?.id, onSession: (id) => { setSession(id); keep(token, id) }, onTurn: setTurn }))
  const runtime = useLocalRuntime(adapter.chatModel, { adapters: { attachments: adapter.attachments }, initialMessages: toMessages(saved?.messages ?? [], saved?.turn ?? null) })

  async function submit() {
    setError('')
    try {
      const r = await fetch(`${base}/intake/api/sessions/${session}/submit`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(turn?.split ? { expect: turn.split.length } : {}) })
      if (!r.ok) throw new Error(String(r.status))
      const { number, numbers } = (await r.json()) as { number: number; numbers?: number[] }
      setSent(numbers ?? [number])
      keep(token, null)
    } catch {
      setError('Could not submit. Please try again.')
    }
  }

  const label = { label: 'Your message', placeholder: 'Describe it in one sentence' }
  return (
    <div className="aui-root fixed right-4 bottom-4 z-[2147483647] flex flex-col items-end gap-2 text-[15px] leading-[22px] text-foreground" style={{ fontFamily: 'var(--font-sans)' }}>
      {open && (
        <section aria-label="Report a problem" className="flex w-[min(360px,calc(100vw-32px))] flex-col gap-3 rounded-lg border bg-background p-3">
          {sent ? (
            <p role="status">{sent.length > 1 ? `Thank you, your requests ${sent.map((n) => `#${n}`).join(', ')} were created.` : `Thank you, your request #${sent[0]} was created.`}</p>
          ) : (
            <AssistantRuntimeProvider runtime={runtime}>
              <ChatThread attachments maxHeight="max-h-72" first={label} next={label} />
              {error && <p role="alert" className="text-destructive">{error}</p>}
              {turn && (turn.ready || turn.exhausted) && <Button type="button" onClick={submit}>Submit request</Button>}
            </AssistantRuntimeProvider>
          )}
        </section>
      )}
      <Button type="button" onClick={() => setOpen(!open)}>Report a problem</Button>
    </div>
  )
}

/** Loads the open session, if any, before the chat mounts (the runtime takes its messages at creation). */
function Loader(props: { base: string; token: string }) {
  const [saved, setSaved] = useState<Saved | null | undefined>()
  useEffect(() => {
    void (async () => {
      try {
        const id = localStorage.getItem(slot(props.token))
        if (!id) return setSaved(null)
        const r = await fetch(`${props.base}/intake/api/sessions/${id}`, { method: 'POST', headers: { authorization: `Bearer ${props.token}`, 'content-type': 'application/json' }, body: '{}' })
        const d = (await r.json()) as { status: string; messages: { role: string; content: string }[]; draft: Turn['draft'] | null; split: Turn['draft'][] | null; turn: Turn | null }
        if (!r.ok || d.status !== 'open' || !d.messages.length) return keep(props.token, null), setSaved(null)
        setSaved({ id, messages: d.messages, turn: d.turn && { ...d.turn, draft: d.draft ?? d.turn.draft, split: d.split ?? undefined } })
      } catch {
        setSaved(null)
      }
    })()
  }, [])
  return saved === undefined ? null : <Widget {...props} saved={saved} />
}

const script = document.currentScript as HTMLScriptElement | null
const token = script?.dataset.token
if (script && token) {
  // Tailwind's @property rules only register in the document, not in a shadow root.
  const style = (text: string) => Object.assign(document.createElement('style'), { textContent: text })
  document.head.append(style((css.match(/@property[^{]+\{[^}]*\}/g) ?? []).join('')))
  const host = document.createElement('div')
  const root = host.attachShadow({ mode: 'open' })
  const mount = document.createElement('div')
  root.append(style(css), mount)
  document.body.append(host)
  createRoot(mount).render(<Loader base={new URL(script.src).origin} token={token} />)
}
