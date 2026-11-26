'use client'

import { AssistantRuntimeProvider, useExternalStoreRuntime, type ThreadMessageLike } from '@assistant-ui/react'
import { useMemo, type ReactNode } from 'react'
import { attachmentAdapter } from '../conversation/conversation-adapter'
import { fileIdsOf, textOf } from '../conversation/useConversationRuntime'
import { conversationApi } from '../conversation/conversation-api'

const api = conversationApi()

type Props = {
  conversation?: () => Promise<number>
  onSend?: (text: string, fileIds: number[]) => Promise<void>
  messages?: ThreadMessageLike[]
  children: ReactNode
}

const NO_MESSAGES: ThreadMessageLike[] = []

export function CommentRuntime({ conversation, onSend, messages = NO_MESSAGES, children }: Props) {
  const attachments = useMemo(() => (conversation ? attachmentAdapter(conversation, api) : undefined), [conversation])
  const runtime = useExternalStoreRuntime({
    messages,
    isRunning: false,
    convertMessage: (message) => message,
    onNew: (message) => onSend?.(textOf(message), fileIdsOf(message)) ?? Promise.resolve(),
    ...(attachments ? { adapters: { attachments } } : {}),
  })
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
}
