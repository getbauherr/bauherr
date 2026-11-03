'use client'
import { useEffect, useRef, useState } from 'react'
import { discardIntake } from '../lib/actions'

type Draft = { problem: string; context: string; acceptance_criteria: string[] }
type Turn = { question: string; options?: { label: string; recommended?: boolean }[]; draft: Draft; split?: Draft[]; ready: boolean; exhausted: boolean }
type Line = { who: 'you' | 'bauherr'; text: string }

const post = async (url: string, body?: unknown): Promise<Response> => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })

const store = (key: string, value?: string) => {
  try {
    value ? localStorage.setItem(key, value) : localStorage.removeItem(key)
  } catch {}
}

export function IntakeChat({ products, initial, others = [], userId }: { userId: number; products: { id: number; name: string }[]; initial?: { id: string; product: number; lines: Line[]; turn: Turn | null }; others?: { id: number; product: string; first: string; when: string }[] }) {
  const [product, setProduct] = useState(initial?.product ?? products[0].id)
  const [session, setSession] = useState<string | null>(initial?.id ?? null)
  const [lines, setLines] = useState<Line[]>(initial?.lines ?? [])
  const [turn, setTurn] = useState<Turn | null>(initial?.turn ?? null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState<number[] | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const key = `intake:${userId}:${session ?? 'new'}`

  useEffect(() => {
    try {
      setText(localStorage.getItem(key) ?? '')
    } catch {}
  }, [])

  async function send(message: string) {
    if (!message.trim() || busy) return
    setBusy(true)
    setError('')
    let added = false
    try {
      let id = session
      if (!id) {
        const r = await post('/intake/api/sessions', { product })
        if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Could not start the request')
        id = String(((await r.json()) as { id: number }).id)
        setSession(id)
      }
      setLines((l) => [...l, { who: 'you', text: message }])
      added = true
      setText('')
      const body = await (await post(`/intake/api/sessions/${id}/messages`, { text: message })).text()
      const ev = body.split('\n\n').find((e) => e.trim())?.split('\n') ?? []
      const data = JSON.parse(ev.find((l) => l.startsWith('data: '))?.slice(6) ?? '{}')
      if (ev[0] === 'event: error' || !data.question) throw new Error(data.message ?? 'No answer from the model')
      setTurn(data)
      setLines((l) => [...l, { who: 'bauherr', text: data.question }])
      store(key)
      store(`intake:${id}`)
      window.history.replaceState(null, '', `/requests/new?session=${id}`)
    } catch (e) {
      setText(message)
      if (added) setLines((l) => l.slice(0, -1))
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      input.current?.focus()
    }
  }

  async function submit() {
    setBusy(true)
    setError('')
    const r = await post(`/intake/api/sessions/${session}/submit`, turn?.split ? { expect: turn.split.length } : {})
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
            <input ref={input} value={text} onChange={(e) => { setText(e.target.value); store(key, e.target.value) }} placeholder={lines.length ? 'Your answer' : 'Describe your request in one sentence'} disabled={busy} maxLength={2000} />
          </label>
          <button type="submit" className="btn" disabled={busy || !text.trim()}>Send</button>
        </form>
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
