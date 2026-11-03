'use client'
import { AssistantRuntimeProvider, useLocalRuntime } from '@assistant-ui/react'
import { useRef, useState } from 'react'
import { discardIntake } from '../lib/actions'
import { makeIntakeAdapter, toMessages, type Turn } from './chat/intake-adapter'
import { ChatThread } from './chat/thread'

type Line = { who: 'you' | 'bauherr'; text: string }

export function IntakeChat({ products, initial, others = [], userId }: { userId: number; products: { id: number; name: string }[]; initial?: { id: string; product: number; lines: Line[]; turn: Turn | null }; others?: { id: number; product: string; first: string; when: string }[] }) {
  const [product, setProduct] = useState(initial?.product ?? products[0].id)
  const [session, setSession] = useState<string | null>(initial?.id ?? null)
  const [turn, setTurn] = useState<Turn | null>(initial?.turn ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState<number[] | null>(null)
  const productRef = useRef(product)
  productRef.current = product
  const [adapter] = useState(() =>
    makeIntakeAdapter({
      base: '',
      product: () => productRef.current,
      session: initial?.id,
      onSession: setSession,
      onTurn: (t) => {
        setTurn(t)
        window.history.replaceState(null, '', `/requests/new?session=${sessionRef.current}`)
      },
    }),
  )
  const sessionRef = useRef(session)
  sessionRef.current = session
  const runtime = useLocalRuntime(adapter.chatModel, {
    adapters: { attachments: adapter.attachments },
    initialMessages: toMessages((initial?.lines ?? []).map((l) => ({ role: l.who === 'you' ? 'user' : 'assistant', content: l.text })), initial?.turn ?? null),
  })

  async function submit() {
    setBusy(true)
    setError('')
    const r = await fetch(`/intake/api/sessions/${session}/submit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(turn?.split ? { expect: turn.split.length } : {}) })
    const data = (await r.json().catch(() => ({}))) as { number?: number; numbers?: number[]; error?: string }
    r.ok && data.number ? setSent(data.numbers ?? [data.number]) : setError(data.error ?? 'Could not send the request')
    setBusy(false)
  }

  if (sent) return <div className="card-lg stack" role="status"><p className="body">{sent.length > 1 ? `Requests ${sent.map((n) => `#${n}`).join(', ')} sent. They wait in Triage.` : `Request #${sent[0]} sent. It waits in Triage.`}</p><a className="btn" href="/">Back to tickets</a></div>

  const draft = turn?.draft
  return (
    <div className="intake">
      <div className="stack">
        {others.length ? (
          <ul className="stack" aria-label="Open requests">
            {others.map((o) => (
              <li key={o.id} className="chips">
                <a href={`/requests/new?session=${o.id}`}>Resume</a>
                <span>{o.product}: {o.first} <span className="muted">{o.when}</span></span>
                <button type="button" className="btn" disabled={busy} onClick={async () => { await discardIntake(o.id); window.location.reload() }}>Discard</button>
              </li>
            ))}
          </ul>
        ) : null}
        <label className="field">
          <span className="label muted">Product</span>
          <select value={product} onChange={(e) => setProduct(Number(e.target.value))} disabled={!!session}>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <AssistantRuntimeProvider runtime={runtime}>
          <ChatThread attachments draftKey={`intake:${userId}:${session ?? 'new'}`} maxHeight="max-h-[60vh]" first={{ label: 'Describe your request', placeholder: 'Describe your request in one sentence' }} next={{ label: 'Your answer', placeholder: 'Your answer' }} />
        </AssistantRuntimeProvider>
        {error && <p className="err" role="alert">{error}</p>}
        {turn && (turn.ready || turn.exhausted) && <div><button type="button" className="btn primary" disabled={busy} onClick={submit}>{turn.split ? `Create ${turn.split.length} tickets` : 'Submit request'}</button></div>}
      </div>
      {draft?.problem && (
        <aside className="card-lg stack" aria-label="Draft">
          <h2 className="label muted">Draft</h2>
          <p className="body">{draft.problem}</p>
          {draft.context && <p className="body muted">{draft.context}</p>}
          {turn?.split ? <ol>{turn.split.map((d) => <li key={d.problem}>{d.problem}</li>)}</ol> : null}
          {draft.acceptance_criteria.length ? <ul>{draft.acceptance_criteria.map((c) => <li key={c}>{c}</li>)}</ul> : null}
        </aside>
      )}
    </div>
  )
}
