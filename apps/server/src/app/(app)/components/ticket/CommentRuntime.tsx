'use client'

import { AssistantRuntimeProvider, useExternalStoreRuntime, type ThreadMessageLike } from '@assistant-ui/react'
import { useMemo, type ReactNode } from 'react'
import { attachmentAdapter } from '../conversation/conversation-adapter'
import { fileIdsOf, textOf } from '../conversation/useConversationRuntime'
import { conversationApi } from '../conversation/conversation-api'

const api = conversationApi()

type Props = {
  conversation: () => Promise<number>
  onSend?: (text: string, fileIds: number[]) => Promise<void>
  children: ReactNode
}

const NO_MESSAGES: ThreadMessageLike[] = []

export function CommentRuntime({ conversation, onSend, children }: Props) {
  const attachments = useMemo(() => attachmentAdapter(conversation, api), [conversation])
  const runtime = useExternalStoreRuntime({
    messages: NO_MESSAGES,
    isRunning: false,
    convertMessage: (message) => message,
    onNew: (message) => onSend?.(textOf(message), fileIdsOf(message)) ?? Promise.resolve(),
    adapters: { attachments },
  })
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
}
