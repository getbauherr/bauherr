'use client'
import { AssistantRuntimeProvider, useLocalRuntime } from '@assistant-ui/react'
import { useRef, useState } from 'react'
import { makeIntakeAdapter, type Turn } from './chat/intake-adapter'
import { ChatThread } from './chat/thread'

export function IntakeChat({ products }: { products: { id: number; name: string }[] }) {
  const [product, setProduct] = useState(products[0].id)
  const [session, setSession] = useState<string | null>(null)
  const [turn, setTurn] = useState<Turn | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState<number | null>(null)
  const productRef = useRef(product)
  productRef.current = product
  const [adapter] = useState(() => makeIntakeAdapter({ base: '', product: () => productRef.current, onSession: setSession, onTurn: setTurn }))
  const runtime = useLocalRuntime(adapter.chatModel, { adapters: { attachments: adapter.attachments } })

  async function submit() {
    setBusy(true)
    setError('')
    const r = await fetch(`/intake/api/sessions/${session}/submit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    const data = (await r.json().catch(() => ({}))) as { number?: number; error?: string }
    r.ok && data.number ? setSent(data.number) : setError(data.error ?? 'Could not send the request')
    setBusy(false)
  }

  if (sent) return <div className="card-lg stack" role="status"><p className="body">Request #{sent} sent. It waits in Triage.</p><a className="btn" href="/">Back to tickets</a></div>

  const draft = turn?.draft
  return (
    <div className="intake">
      <div className="stack">
        <label className="field">
          <span className="label muted">Product</span>
          <select value={product} onChange={(e) => setProduct(Number(e.target.value))} disabled={!!session}>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <AssistantRuntimeProvider runtime={runtime}>
          <ChatThread attachments maxHeight="max-h-[60vh]" first={{ label: 'Describe your request', placeholder: 'Describe your request in one sentence' }} next={{ label: 'Your answer', placeholder: 'Your answer' }} />
        </AssistantRuntimeProvider>
        {error && <p className="err" role="alert">{error}</p>}
        {turn && (turn.ready || turn.exhausted) && <div><button type="button" className="btn primary" disabled={busy} onClick={submit}>Submit request</button></div>}
      </div>
      {draft?.problem && (
        <aside className="card-lg stack" aria-label="Draft">
          <h2 className="label muted">Draft</h2>
          <p className="body">{draft.problem}</p>
          {draft.context && <p className="body muted">{draft.context}</p>}
          {draft.acceptance_criteria.length ? <ul>{draft.acceptance_criteria.map((c) => <li key={c}>{c}</li>)}</ul> : null}
        </aside>
      )}
    </div>
  )
}
