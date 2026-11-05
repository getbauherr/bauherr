'use client'
import { AssistantRuntimeProvider, useLocalRuntime } from '@assistant-ui/react'
import { useEffect, useRef, useState } from 'react'
import { discardIntake } from '../lib/actions'
import { makeIntakeAdapter, toMessages, type Turn } from './chat/intake-adapter'
import { ChatThread } from './chat/thread'
import { Button } from './ui/button'

const LAST_PRODUCT = 'bauherr-product'

type Line = { who: 'you' | 'bauherr'; text: string }

/** Modal confirmation for discarding a draft; `onClose` fires on every close (Escape, Keep draft). */
function DiscardDialog({ first, busy, error, onClose, onDiscard }: { first: string; busy: boolean; error: string; onClose: () => void; onDiscard: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => ref.current?.showModal(), [])
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="discard-title" className="m-auto w-[min(92vw,420px)] rounded-md border border-border bg-card p-6 text-card-foreground backdrop:bg-black/50">
      <div className="flex flex-col gap-4">
        <h2 id="discard-title" className="heading">Discard this draft?</h2>
        <p className="body text-muted-foreground">{first}</p>
        {error && <p className="err" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => ref.current?.close()}>Keep draft</Button>
          <Button type="button" variant="destructive" disabled={busy} onClick={onDiscard}>Discard</Button>
        </div>
      </div>
    </dialog>
  )
}

export function IntakeChat({ products, initial, others = [], userId }: { userId: number; products: { id: number; name: string }[]; initial?: { id: string; product: number; lines: Line[]; turn: Turn | null }; others?: { id: number; product: string; first: string; when: string }[] }) {
  const [product, setProduct] = useState(initial?.product ?? products[0].id)
  const [session, setSession] = useState<string | null>(initial?.id ?? null)
  const [turn, setTurn] = useState<Turn | null>(initial?.turn ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState<number[] | null>(null)
  const [discarding, setDiscarding] = useState<{ id: number; first: string } | null>(null)
  const [discardError, setDiscardError] = useState('')
  const pick = (id: number) => {
    setProduct(id)
    try {
      localStorage.setItem(LAST_PRODUCT, String(id))
    } catch {}
  }
  useEffect(() => {
    if (initial) return
    try {
      const last = Number(localStorage.getItem(LAST_PRODUCT))
      if (products.some((p) => p.id === last)) setProduct(last)
    } catch {}
  }, [initial, products])
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

  if (sent) return <div className="card-lg stack" role="status"><p className="body">{sent.length > 1 ? `Requests ${sent.map((n) => `#${n}`).join(', ')} sent. We'll ask if anything is unclear.` : `Request #${sent[0]} sent. We'll ask if anything is unclear.`}</p><a className="btn" href="/">Back to tickets</a></div>

  const draft = turn?.draft
  return (
    <div className="intake">
      <div className="stack">
        <h2 className="label muted">Your drafts</h2>
        {others.length ? (
          <ul className="stack" aria-label="Your drafts">
            {others.map((o) => (
              <li key={o.id} className="chips">
                <a href={`/requests/new?session=${o.id}`}>Resume</a>
                <span>{products.length > 1 && `${o.product}: `}{o.first} <span className="muted">{o.when}</span></span>
                <Button type="button" variant="outline" disabled={busy} onClick={() => setDiscarding({ id: o.id, first: o.first })}>Discard</Button>
              </li>
            ))}
          </ul>
        ) : <p className="small muted">No open drafts.</p>}
        <a className="small muted" href="/requests">Requests</a>
        {products.length > 1 && (
          <label className="field">
            <span className="label muted">Product</span>
            <select value={product} onChange={(e) => pick(Number(e.target.value))} disabled={!!session}>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
        <AssistantRuntimeProvider runtime={runtime}>
          <ChatThread attachments draftKey={`intake:${userId}:${session ?? 'new'}`} maxHeight="max-h-[60vh]" first={{ label: 'Describe your request', placeholder: 'Describe your request in one sentence' }} next={{ label: 'Your answer', placeholder: 'Your answer' }} />
        </AssistantRuntimeProvider>
        {discarding && <DiscardDialog first={discarding.first} busy={busy} error={discardError} onClose={() => { setDiscarding(null); setDiscardError('') }} onDiscard={async () => {
          setBusy(true)
          setDiscardError('')
          try {
            await discardIntake(discarding.id)
            // revalidatePath refreshes the list; only the open session's chat needs a fresh page
            if (String(discarding.id) === session) window.location.reload()
            else setDiscarding(null)
          } catch {
            setDiscardError('Could not discard the draft. Please try again.')
          } finally {
            setBusy(false)
          }
        }} />}
        {error && <p className="err" role="alert">{error}</p>}
        {turn && (turn.ready || turn.exhausted) && <div><button type="button" className="btn primary" disabled={busy} onClick={submit}>{turn.split ? `Create ${turn.split.length} tickets` : 'Submit request'}</button></div>}
      </div>
      {draft?.problem && (
        <aside className="card-lg stack" aria-label="Draft">
          <h2 className="label muted">Draft</h2>
          <p className="body">{draft.problem}</p>
          {draft.context && <details><summary className="small muted">Context</summary><p className="body muted">{draft.context}</p></details>}
          {turn?.split ? <ol>{turn.split.map((d) => <li key={d.problem}>{d.problem}</li>)}</ol> : null}
          {draft.acceptance_criteria.length ? <ul>{draft.acceptance_criteria.map((c) => <li key={c}>{c}</li>)}</ul> : null}
        </aside>
      )}
    </div>
  )
}
