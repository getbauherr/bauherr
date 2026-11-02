'use client'
import { useRef, useState } from 'react'

type Draft = { problem: string; context: string; acceptance_criteria: string[] }
type Turn = { question: string; options?: { label: string; recommended?: boolean }[]; draft: Draft; ready: boolean; exhausted: boolean }
type Line = { who: 'you' | 'bauherr'; text: string }

const post = async (url: string, body?: unknown): Promise<Response> => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })

export function IntakeChat({ products }: { products: { id: number; name: string }[] }) {
  const [product, setProduct] = useState(products[0].id)
  const [session, setSession] = useState<string | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [turn, setTurn] = useState<Turn | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState<number | null>(null)
  const input = useRef<HTMLInputElement>(null)

  async function send(message: string) {
    if (!message.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      let id = session
      if (!id) {
        const r = await post('/intake/api/sessions', { product })
        if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Could not start the request')
        id = String(((await r.json()) as { id: number }).id)
        setSession(id)
      }
      setLines((l) => [...l, { who: 'you', text: message }])
      setText('')
      const body = await (await post(`/intake/api/sessions/${id}/messages`, { text: message })).text()
      const ev = body.split('\n\n').find((e) => e.trim())?.split('\n') ?? []
      const data = JSON.parse(ev.find((l) => l.startsWith('data: '))?.slice(6) ?? '{}')
      if (ev[0] === 'event: error' || !data.question) throw new Error(data.message ?? 'No answer from the model')
      setTurn(data)
      setLines((l) => [...l, { who: 'bauherr', text: data.question }])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      input.current?.focus()
    }
  }

  async function submit() {
    setBusy(true)
    setError('')
    const r = await post(`/intake/api/sessions/${session}/submit`)
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
        <ol className="chat" aria-live="polite">
          {lines.map((l, i) => <li key={i} className={`msg ${l.who}`}>{l.text}</li>)}
        </ol>
        {turn?.options?.length ? (
          <div className="chips">
            {turn.options.map((o) => <button key={o.label} type="button" className={`btn${o.recommended ? ' primary' : ''}`} disabled={busy} onClick={() => send(o.label)}>{o.label}</button>)}
          </div>
        ) : null}
        <form className="sform inline" onSubmit={(e) => { e.preventDefault(); send(text) }}>
          <label className="field grow">
            <span className="sr">{lines.length ? 'Your answer' : 'Describe your request'}</span>
            <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder={lines.length ? 'Your answer' : 'Describe your request in one sentence'} disabled={busy} maxLength={2000} />
          </label>
          <button type="submit" className="btn" disabled={busy || !text.trim()}>Send</button>
        </form>
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
