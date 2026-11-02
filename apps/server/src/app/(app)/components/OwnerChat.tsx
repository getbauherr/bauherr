'use client'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { answerOwnerChat, startOwnerChat } from '../lib/actions'

type Q = { decision: string; question: string; options: { label: string; recommended: boolean }[]; left: number }

export function OwnerChat({ ticket }: { ticket: number }) {
  const router = useRouter()
  const [session, setSession] = useState<number | null>(null)
  const [log, setLog] = useState<{ role: 'bauherr' | 'you'; text: string }[]>([])
  const [q, setQ] = useState<Q | null>(null)
  const [failed, setFailed] = useState(false)
  const [pending, run] = useTransition()

  const start = () =>
    run(async () => {
      try {
        const { session, ...first } = await startOwnerChat(ticket)
        setSession(session)
        setQ(first)
        setLog([{ role: 'bauherr', text: first.question }])
      } catch {
        setFailed(true)
      }
    })
  const answer = (label: string) =>
    run(async () => {
      if (!session || !q) return
      try {
        const next = await answerOwnerChat(session, ticket, q.decision, label)
        setLog((l) => [...l, { role: 'you', text: label }, ...(next ? [{ role: 'bauherr' as const, text: next.question }] : [])])
        setQ(next)
        if (!next) router.refresh()
      } catch {
        setFailed(true)
      }
    })

  if (!session) {
    return (
      <p>
        <button type="button" className="btn" onClick={start} disabled={pending}>Answer interactively</button>
        {failed && <span className="small muted"> The questions could not be loaded.</span>}
      </p>
    )
  }
  return (
    <section className="chat sheet" aria-label="Answer interactively">
      <ol className="chat-log">
        {log.map((m, i) => <li key={i} className={m.role === 'you' ? 'you' : undefined}>{m.text}</li>)}
      </ol>
      {q ? (
        <footer>
          {q.options.map((o) => <button key={o.label} type="button" className={o.recommended ? 'btn primary' : 'btn'} disabled={pending} onClick={() => answer(o.label)}>{o.label}{o.recommended ? ' (recommended)' : ''}</button>)}
          <span className="small muted">{q.left} open</span>
        </footer>
      ) : (
        <footer><span className="small muted">All questions answered.</span></footer>
      )}
      {failed && <p className="small muted">That answer could not be saved. Reload the page.</p>}
    </section>
  )
}
