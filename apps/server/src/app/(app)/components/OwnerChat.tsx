'use client'
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter, type ThreadMessageLike } from '@assistant-ui/react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { askOwnerChat, startOwnerChat } from '../lib/actions'
import { ChatThread } from './chat/thread'
import { toMessages } from './chat/intake-adapter'
import { Card } from './ui/card'

type Q = { decision: string; question: string; options: { label: string; recommended: boolean }[]; left: number }
type Started = Q & { session: number; messages: { role: string; content: string }[] }

/** Offered after an explain reply to a typed message; sends that message again as the answer, without the model. */
const USE_TEXT = 'Use my text as the answer'

const say = (text: string, turn?: Q) => ({ content: [{ type: 'text' as const, text }], ...(turn && { metadata: { custom: { turn } } }) })

function Interview({ start, ticket }: { start: Started; ticket: number }) {
  const router = useRouter()
  const { session, messages, ...first } = start
  const [left, setLeft] = useState<number | null>(first.left)
  const current = useRef<Q>(first)
  const typed = useRef<string | null>(null)
  const [adapter] = useState<ChatModelAdapter>(() => ({
    async run({ messages }) {
      const text = messages.at(-1)!.content.map((p) => (p.type === 'text' ? p.text : '')).join('')
      const literal = text === USE_TEXT && typed.current !== null
      const next = await askOwnerChat(session, ticket, current.current.decision, literal ? typed.current! : text, literal)
      if ('reply' in next) {
        typed.current = next.retry ? text : null
        return say(next.reply, next.retry ? { ...current.current, options: [...current.current.options, { label: USE_TEXT, recommended: false }] } : current.current)
      }
      typed.current = null
      if ('done' in next) {
        setLeft(null)
        router.refresh()
        return say(next.summary)
      }
      current.current = next
      setLeft(next.left)
      return say(next.question, next)
    },
  }))
  const runtime = useLocalRuntime(adapter, { initialMessages: toMessages(messages, first) as ThreadMessageLike[] })
  return (
    <Card asChild className="max-w-[640px] scroll-mt-[calc(72px+var(--space-4))]">
      <section id="answer" aria-label="Answer questions">
        <AssistantRuntimeProvider runtime={runtime}>
          <ChatThread composer={left !== null} maxLength={500} maxHeight="max-h-[60vh]" draftKey={`owner-chat-${ticket}`} first={{ label: 'Your answer', placeholder: 'Type your answer' }} next={{ label: 'Your answer', placeholder: 'Type your answer' }} />
        </AssistantRuntimeProvider>
        {left !== null && <p className="small text-muted-foreground">{left} open</p>}
      </section>
    </Card>
  )
}

/** One chat for every open owner question of a Ticket; a reload resumes at the current question. After the last answer the page refreshes around it and the summary stays. */
export function OwnerChat({ ticket, open }: { ticket: number; open: number }) {
  const [start, setStart] = useState<Started | null>(null)
  const [failed, setFailed] = useState(false)
  const started = useRef(false)
  useEffect(() => {
    if (!open || started.current) return
    started.current = true
    startOwnerChat(ticket).then(setStart, () => setFailed(true))
  }, [])
  if (start) return <Interview start={start} ticket={ticket} />
  if (!open) return null
  return <p id="answer" className="small scroll-mt-[calc(72px+var(--space-4))] text-muted-foreground">{failed ? 'The questions could not be loaded.' : 'Loading the questions…'}</p>
}
