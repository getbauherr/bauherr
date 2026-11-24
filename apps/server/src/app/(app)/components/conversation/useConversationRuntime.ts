'use client'

import { useExternalStoreRuntime, type AppendMessage } from '@assistant-ui/react'
import { useMemo, useState } from 'react'
import { attachmentAdapter, toThreadMessage } from './conversation-adapter'
import type { ConversationApi, ConversationEntry } from './conversation-api'

export const textOf = (message: AppendMessage): string =>
  message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n')

export const fileIdsOf = (message: AppendMessage): number[] =>
  (message.attachments ?? []).map((attachment) => Number(attachment.id))

export function useConversationRuntime(
  conversationId: number,
  initial: ConversationEntry[],
  api: ConversationApi,
) {
  const [entries, setEntries] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const attachments = useMemo(
    () => attachmentAdapter(() => Promise.resolve(conversationId), api),
    [conversationId, api],
  )
  const runtime = useExternalStoreRuntime<ConversationEntry>({
    messages: entries,
    isRunning: false,
    convertMessage: (entry) => toThreadMessage(conversationId, entry),
    onNew: async (message) => {
      setError(null)
      try {
        await api.send(conversationId, textOf(message), fileIdsOf(message))
        setEntries(await api.messages(conversationId))
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'The message was not sent.')
      }
    },
    adapters: { attachments },
  })
  return { runtime, error }
}
