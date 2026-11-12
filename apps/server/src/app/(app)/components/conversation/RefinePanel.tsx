'use client'
import { useRouter } from 'next/navigation'
import { AssistantRuntimeProvider, useExternalStoreRuntime, type ThreadMessageLike } from '@assistant-ui/react'
import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react'
import { Check } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { refineChange, refineExplain, refineFinish, refinePick, refineRest, refineSay, refineState } from '../../lib/actions'
import type { View } from '../../../../lib/refine/engine'
import { openOf, type Msg } from '../../../../lib/refine/model'
import { Conversation } from './Conversation'
import { CurrentPoint } from './CurrentPoint'
import { OpenPoints, countOf } from './OpenPoints'
import { SummaryCard } from './SummaryCard'

type Reply = { view: View | null } | { error: string }

const toMessage = (m: Msg): ThreadMessageLike => ({
  id: m.id,
  role: m.role,
  createdAt: new Date(m.speaker.at),
  content: [{ type: 'text', text: m.text }],
  ...(m.role === 'assistant' && { status: { type: 'complete', reason: 'stop' } as const }),
  metadata: { custom: { speaker: m.speaker, feedback: m.feedback ?? null } },
})

const textOf = (m: { content: readonly { type: string; text?: string }[] }): string => m.content.map((p) => (p.type === 'text' ? p.text : '')).join('').trim()

/**
 * The refinement conversation of a Ticket, embedded where it is needed (Ticket page, Inbox card): the strip says who answers, the open points sit pinned next to the conversation,
 * the current point asks with its options, and when nothing is open the summary offers "Send to planning". Every action answers the whole state; the panel never merges.
 * Renders nothing while the Ticket has no points.
 */
export const RefinePanel: FC<{ ticket: number; /** The Ticket page's one panel carries the `#refine` anchor. */ anchor?: boolean; onSent?(): void }> = ({ ticket, anchor, onSent }) => {
  const router = useRouter()
  const [view, setView] = useState<View | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [restore, setRestore] = useState('')
  const [kept, setKept] = useState(false)
  const [recorded, setRecorded] = useState<string | null>(null)
  useEffect(() => {
    if (!recorded) return
    const t = setTimeout(() => setRecorded(null), 2500)
    return () => clearTimeout(t)
  }, [recorded])
  const alive = useRef(true)
  useEffect(() => () => void (alive.current = false), [])

  const take = useCallback((r: Reply): boolean => {
    if ('error' in r) return setError(r.error), false
    setError(null)
    setView(r.view)
    return true
  }, [])
  useEffect(() => {
    void refineState(ticket).then((r) => alive.current && take(r)).catch(() => alive.current && setError('The conversation could not be loaded.'))
  }, [ticket, take])

  const loaded = view !== undefined
  useEffect(() => {
    // `#refine` (action bar) and the old `#answer` anchors: the panel appears after the fetch, so the browser's own jump would miss it.
    if (anchor && loaded && ['#refine', '#answer'].includes(location.hash)) document.getElementById('refine')?.scrollIntoView({ block: 'start' })
  }, [anchor, loaded])

  const act = useCallback(
    async (run: () => Promise<Reply>): Promise<boolean> => {
      setBusy(true)
      try {
        const ok = take(await run())
        if (ok) router.refresh()
        return ok
      } catch {
        setError('That did not go through. Try again.')
        return false
      } finally {
        setBusy(false)
      }
    },
    [take, router],
  )

  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages: useMemo(() => (view?.messages ?? []).map(toMessage), [view?.messages]),
    isRunning: busy,
    convertMessage: (m) => m,
    onNew: async (m) => {
      const text = textOf(m)
      if (!text) return
      setKept(false)
      if (!(await act(() => refineSay(ticket, text)))) setRestore(text)
    },
  })

  if (!view) return error ? <p role="alert" className="small m-0 text-destructive">{error}</p> : null
  const open = openOf(view.points)
  const current = open[0]
  const locked = view.sent
  const send = async () => {
    if (await act(() => refineFinish(ticket))) onSent?.()
  }
  return (
    <section id={anchor ? 'refine' : undefined} data-testid="refine-panel" data-state={locked ? 'sent' : open.length ? 'open' : 'summary'} aria-label="Refine this Ticket" className="@container flex scroll-mt-20 flex-col gap-3">
      <header className="flex flex-col gap-1">
        <h2 className="heading m-0 flex flex-wrap items-baseline gap-x-3">{locked ? 'Conversation' : 'Refine'}<span className="small font-normal text-muted-foreground">{countOf(view.points)}</span></h2>
        <p data-testid="refine-strip" className="small m-0 text-muted-foreground">
          {locked
            ? `Sent to planning. This conversation is read-only history.`
            : `You are talking to the ${view.strip.assistant}${view.strip.model ? ` (${view.strip.model})` : ''}. Your answers go to ${view.strip.to} when you send them.`}
        </p>
      </header>
      <div className="grid items-start gap-4 @xl:grid-cols-[minmax(0,1fr)_16rem]">
        <OpenPoints points={view.points} busy={busy} locked={locked} onChange={(id) => void act(() => refineChange(ticket, id))} />
        <div className="flex min-w-0 flex-col gap-3 @xl:order-first">
          {view.earlier.length > 0 && (
            <details data-testid="earlier" className="small rounded-md border p-2 text-muted-foreground">
              <summary className="cursor-pointer">Earlier conversation ({view.earlier.length})</summary>
              <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">{view.earlier.map((m, i) => <li key={i} className="wrap-anywhere whitespace-pre-wrap"><span className="font-medium text-foreground">{m.role === 'user' ? 'You' : 'Assistant'}: </span>{m.text.slice(0, 600)}</li>)}</ul>
            </details>
          )}
          <AssistantRuntimeProvider runtime={runtime}>
            <Conversation thread={view.thread} locked={locked} restore={restore} onRestored={() => setRestore('')}>
              {error && <p role="alert" data-testid="refine-error" className="small m-0 text-destructive">{error}</p>}
              {recorded && <p role="status" data-testid="recorded" className="small m-0 flex items-center gap-1.5 text-ok"><Check />Recorded. {recorded}</p>}
              {!locked && current && <CurrentPoint point={current} open={open.length} busy={busy} onPick={async (i) => { if (!(await act(() => refinePick(ticket, current.id, i)))) throw new Error('not recorded'); setRecorded(`${current.title}: ${current.options[i]}`) }} onWhy={() => void act(() => refineExplain(ticket, current.id))} onRest={() => void act(() => refineRest(ticket))} />}
              {view.summary && !(kept && !locked) && <SummaryCard summary={view.summary} sent={locked} busy={busy} onSend={() => void send()} onKeep={() => setKept(true)} />}
              {view.summary && kept && !locked && <div><Button type="button" size="sm" variant="outline" onClick={() => setKept(false)}>Review the summary</Button></div>}
            </Conversation>
          </AssistantRuntimeProvider>
        </div>
      </div>
    </section>
  )
}
