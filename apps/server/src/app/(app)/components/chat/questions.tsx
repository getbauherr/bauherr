'use client'
import { useAui } from '@assistant-ui/react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FC } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { askOwnerChat, startOwnerChat } from '../../lib/actions'
import { Shield } from './icons'

type Question = { decision: string; question: string; why?: string; options: { label: string; recommended: boolean }[]; left: number }
type View =
  | { s: 'loading' }
  | { s: 'none' }
  | { s: 'ask'; session: number; q: Question; total: number; reply?: string; retry?: string; error?: string }
  | { s: 'done'; summary: string }

/** The card that is open right now, so the composer's `/answer <text>` reaches it. */
let answerer: ((text: string) => void) | null = null
const listeners = new Set<() => void>()
const setAnswerer = (f: typeof answerer) => {
  answerer = f
  listeners.forEach((l) => l())
}
export const useHasQuestion = (): boolean => useSyncExternalStore((cb) => (listeners.add(cb), () => void listeners.delete(cb)), () => !!answerer, () => false)
export const answerWithText = (text: string): void => answerer?.(text)

/** Fixed last option of every question: not an answer, a follow-up for the chat model. */
const asWhy = (q: Question) => `Why does this matter? Question: "${q.question}". Options: ${q.options.slice(0, -1).map((o) => o.label).join(' | ')}`

/**
 * The owner's open questions of a Ticket, one at a time (critical first), as a card in the Ticket thread. The same server functions as the old answer box record every answer
 * (`startOwnerChat` / `askOwnerChat`): a click on an option never calls a model; "Why does this matter?" is sent to the chat as a message; free text goes through `/answer <text>`.
 * Hidden when nothing is open; after the last answer it keeps the one-line summary.
 */
export const Questions: FC<{ ticket: number }> = ({ ticket }) => {
  const router = useRouter()
  const aui = useAui()
  const [view, setView] = useState<View>({ s: 'loading' })
  const [busy, setBusy] = useState(false)
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    startOwnerChat(ticket).then(
      (r) => setView(r ? { s: 'ask', session: r.session, total: r.left, q: { decision: r.decision, question: r.question, why: r.why, options: r.options, left: r.left } } : { s: 'none' }),
      () => setView({ s: 'none' }),
    )
  }, [ticket])

  const ask = useCallback(
    async (text: string, literal?: boolean) => {
      if (view.s !== 'ask' || busy) return
      const { session, q, total } = view
      setBusy(true)
      try {
        const next = await askOwnerChat(session, ticket, q.decision, text, literal)
        if ('reply' in next) setView({ s: 'ask', session, q, total, reply: next.reply, ...(next.retry && { retry: text }) })
        else {
          setView('done' in next ? { s: 'done', summary: next.summary } : { s: 'ask', session, total: Math.max(total, next.left), q: next })
          router.refresh()
        }
      } catch {
        setView({ s: 'ask', session, q, total, error: 'The answer could not be saved. Try again.' })
      } finally {
        setBusy(false)
      }
    },
    [view, busy, ticket, router],
  )

  const open = view.s === 'ask'
  useEffect(() => {
    if (!open) return
    setAnswerer((text) => void ask(text))
    return () => setAnswerer(null)
  }, [open, ask])

  if (view.s === 'loading' || view.s === 'none') return null
  if (view.s === 'done') {
    return (
      <section aria-label="Answer questions" data-testid="question-card" data-state="done" className="my-2 flex flex-col gap-1 rounded-md border bg-card p-3 text-[13px] leading-5 text-card-foreground">
        <p role="status" className="m-0">{view.summary}</p>
      </section>
    )
  }
  const { q, total, reply, retry, error } = view
  const [why, ...rest] = [q.options.at(-1)!, ...q.options.slice(0, -1)]
  return (
    <section aria-label="Answer questions" data-testid="question-card" data-state="open" className="my-2 flex flex-col gap-2 rounded-md border bg-card p-3 text-card-foreground">
      <p className="m-0 flex items-center gap-2 text-xs font-medium text-muted-foreground"><Shield />Question {Math.max(total - q.left, 0) + 1} of {Math.max(total, q.left)}</p>
      <h3 className="m-0 text-[14px] leading-5 font-semibold wrap-anywhere">{q.question}</h3>
      {q.why && <p className="m-0 text-[13px] leading-5 text-muted-foreground">{q.why}</p>}
      <div className="flex flex-wrap gap-2">
        {rest.map((o) => (
          <Button key={o.label} type="button" size="sm" variant={o.recommended ? 'default' : 'outline'} className="h-auto min-h-8 max-w-full py-1.5 text-left whitespace-normal" disabled={busy} onClick={() => void ask(o.label)}>
            {o.label}{o.recommended && <span className="font-normal opacity-80"> (recommended)</span>}
          </Button>
        ))}
        <Button type="button" size="sm" variant="outline" className="h-auto min-h-8 py-1.5" disabled={busy} onClick={() => aui.thread().append(asWhy(q))}>{why.label}</Button>
      </div>
      {reply && <p className="m-0 text-[13px] leading-5">{reply}</p>}
      {retry && <div><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void ask(retry, true)}>Use my text as the answer</Button></div>}
      {error && <p role="alert" className="m-0 text-[13px] text-destructive">{error}</p>}
      <p className={cn('m-0 text-xs text-muted-foreground', busy && 'animate-pulse')}>{busy ? 'Saving...' : `${q.left} open · type your own answer as /answer <text>`}</p>
    </section>
  )
}
