'use client'

import { AssistantRuntimeProvider, useExternalStoreRuntime } from '@assistant-ui/react'
import { useRouter } from 'next/navigation'
import { useOptimistic, useState, useTransition, type ReactNode } from 'react'
import { sendMessageAction } from '../../(shell)/memory/retro/actions'
import { Thread } from '../assistant-ui/elements/thread.aui'
import { FlatToolGroup } from '../conversation/tool-ui'
import { textOf } from '../conversation/useConversationRuntime'
import { ProposeToolUI } from './ProposalCard'
import { RetroFiguresToolUI } from './RetroFigures'
import { toThreadMessage, type RetroEntry } from './retro-adapter'

type Props = {
  retro: number
  entries: RetroEntry[]
  agreed: string[]
  titles: Record<number, string>
  open: boolean
  empty: ReactNode
}

export function RetroThread({ retro, entries, agreed, titles, open, empty }: Props) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [shown, ask] = useOptimistic(entries, (current, body: string) => [
    ...current,
    { id: 'pending', role: 'owner' as const, body, proposals: [], opening: null },
  ])
  const runtime = useExternalStoreRuntime<RetroEntry>({
    messages: shown,
    isRunning: pending,
    convertMessage: toThreadMessage(retro, agreed, titles),
    onNew: async (message) => {
      const body = textOf(message)
      start(async () => {
        ask(body)
        const result = await sendMessageAction(retro, body)
        setError(result.error ?? null)
        router.refresh()
      })
    },
  })
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <RetroFiguresToolUI />
      <ProposeToolUI />
      <div
        role="log"
        aria-label="Conversation"
        className="grid h-[calc(100dvh-16rem)] min-h-[28rem] grid-rows-[minmax(0,1fr)_auto]"
      >
        <Thread
          autoFocus={false}
          components={{
            welcome: empty,
            ToolGroup: FlatToolGroup,
            composer: open && entries.length > 0,
            placeholder: 'Answer the factory or ask a question',
          }}
        />
        {error && (
          <p role="alert" className="small m-0 text-destructive">
            {error}
          </p>
        )}
      </div>
    </AssistantRuntimeProvider>
  )
}
