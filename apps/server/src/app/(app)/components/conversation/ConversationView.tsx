'use client'

import { AssistantRuntimeProvider } from '@assistant-ui/react'
import { conversationApi, type ConversationEntry } from './conversation-api'
import { Thread } from './Thread'
import { useConversationRuntime } from './useConversationRuntime'

const api = conversationApi()

type Props = { conversationId: number; initial: ConversationEntry[] }

export function ConversationView({ conversationId, initial }: Props) {
  const { runtime, error } = useConversationRuntime(conversationId, initial, api)
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread error={error} />
    </AssistantRuntimeProvider>
  )
}
