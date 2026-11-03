/**
 * Embeddable Intake chat, built to public/intake/widget.js (scripts/build-widget.ts).
 * Usage: `<script src="https://HOST/intake/widget.js" data-token="bemb_..."></script>`.
 */
import { AssistantRuntimeProvider, useLocalRuntime } from '@assistant-ui/react'
import css from 'widget:css'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { makeIntakeAdapter, type Turn } from '@/components/chat/intake-adapter'
import { ChatThread } from '@/components/chat/thread'
import { Button } from '@/components/ui/button'

function Widget({ base, token }: { base: string; token: string }) {
  const [open, setOpen] = useState(false)
  const [turn, setTurn] = useState<Turn | null>(null)
  const [sent, setSent] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [session, setSession] = useState<string | null>(null)
  const [adapter] = useState(() => makeIntakeAdapter({ base, headers: { authorization: `Bearer ${token}` }, onSession: setSession, onTurn: setTurn }))
  const runtime = useLocalRuntime(adapter.chatModel)

  async function submit() {
    setError('')
    try {
      const r = await fetch(`${base}/intake/api/sessions/${session}/submit`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' })
      if (!r.ok) throw new Error(String(r.status))
      setSent(((await r.json()) as { number: number }).number)
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
            <p role="status">Thank you, your request #{sent} was created.</p>
          ) : (
            <AssistantRuntimeProvider runtime={runtime}>
              <ChatThread maxHeight="max-h-72" first={label} next={label} />
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
  createRoot(mount).render(<Widget base={new URL(script.src).origin} token={token} />)
}
