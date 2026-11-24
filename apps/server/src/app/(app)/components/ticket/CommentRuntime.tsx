'use client'

import { AssistantRuntimeProvider, useExternalStoreRuntime, type ThreadMessageLike } from '@assistant-ui/react'
import { useMemo, type ReactNode } from 'react'
import { attachmentAdapter } from '../conversation/conversation-adapter'
import { conversationApi } from '../conversation/conversation-api'

const api = conversationApi()

type Props = { conversation: () => Promise<number>; children: ReactNode }

const NO_MESSAGES: ThreadMessageLike[] = []

export function CommentRuntime({ conversation, children }: Props) {
  const attachments = useMemo(() => attachmentAdapter(conversation, api), [conversation])
  const runtime = useExternalStoreRuntime({
    messages: NO_MESSAGES,
    isRunning: false,
    convertMessage: (message) => message,
    onNew: () => Promise.resolve(),
    adapters: { attachments },
  })
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
}
