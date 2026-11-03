'use client'
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter } from '@assistant-ui/react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { answerOwnerChat, startOwnerChat } from '../lib/actions'
import { ChatThread } from './chat/thread'
import { Button } from './ui/button'
import { Card } from './ui/card'

type Q = { decision: string; question: string; options: { label: string; recommended: boolean }[]; left: number }

const messageOf = (q: Q) => ({ role: 'assistant' as const, content: [{ type: 'text' as const, text: q.question }], metadata: { custom: { turn: q } } })

function Interview({ session, ticket, first }: { session: number; ticket: number; first: Q }) {
  const router = useRouter()
  const [q, setQ] = useState<Q | null>(first)
  const current = useRef<Q | null>(first)
  const [adapter] = useState<ChatModelAdapter>(() => ({
    async run({ messages }) {
      const label = messages.at(-1)!.content.map((p) => (p.type === 'text' ? p.text : '')).join('')
      const next = await answerOwnerChat(session, ticket, current.current!.decision, label)
      current.current = next
      setQ(next)
      if (!next) router.refresh()
      return next ? { content: [{ type: 'text', text: next.question }], metadata: { custom: { turn: next } } } : { content: [{ type: 'text', text: 'All questions answered.' }] }
    },
  }))
  const runtime = useLocalRuntime(adapter, { initialMessages: [messageOf(first)] })
  return (
    <Card asChild className="max-w-[640px] scroll-mt-[calc(72px+var(--space-4))]">
    <section id="answer" aria-label="Answer interactively">
      <AssistantRuntimeProvider runtime={runtime}>
        <ChatThread composer={false} maxHeight="max-h-[50vh]" first={{ label: '', placeholder: '' }} next={{ label: '', placeholder: '' }} />
      </AssistantRuntimeProvider>
      {q && <p className="small text-muted-foreground">{q.left} open</p>}
    </section>
    </Card>
  )
}

export function OwnerChat({ ticket }: { ticket: number }) {
  const [start, setStart] = useState<{ session: number; first: Q } | null>(null)
  const [failed, setFailed] = useState(false)
  const [pending, run] = useTransition()
  const started = useRef(false)

  const begin = () =>
    run(async () => {
      if (started.current) return
      started.current = true
      try {
        const { session, ...first } = await startOwnerChat(ticket)
        setStart({ session, first })
      } catch {
        started.current = false
        setFailed(true)
      }
    })
  useEffect(() => {
    const go = () => location.hash === '#answer' && begin()
    go()
    addEventListener('hashchange', go)
    return () => removeEventListener('hashchange', go)
  }, [])

  if (!start) {
    return (
      <p id="answer" className="scroll-mt-[calc(72px+var(--space-4))]">
        <Button type="button" variant="outline" onClick={begin} disabled={pending}>Answer interactively</Button>
        {failed && <span className="small text-muted-foreground"> The questions could not be loaded.</span>}
      </p>
    )
  }
  return <Interview {...start} ticket={ticket} />
}
