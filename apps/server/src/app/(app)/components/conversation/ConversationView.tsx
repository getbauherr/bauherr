'use client'

import { AssistantRuntimeProvider } from '@assistant-ui/react'
import { Thread } from '../assistant-ui/elements/thread.aui'
import { conversationApi, type ConversationEntry } from './conversation-api'
import { useConversationRuntime } from './useConversationRuntime'

const api = conversationApi()

type Props = { conversationId: number; initial: ConversationEntry[] }

export function ConversationView({ conversationId, initial }: Props) {
  const { runtime, error } = useConversationRuntime(conversationId, initial, api)
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto]">
        <Thread components={{ placeholder: 'Write a message' }} autoFocus={false} />
        {error && (
          <p role="alert" className="small m-0 text-destructive">
            {error}
          </p>
        )}
      </div>
    </AssistantRuntimeProvider>
  )
}
