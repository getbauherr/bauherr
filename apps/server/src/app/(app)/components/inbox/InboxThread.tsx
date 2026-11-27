'use client'
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type ExternalStoreThreadListAdapter,
  type ThreadMessageLike,
} from '@assistant-ui/react'
import type { ReactNode } from 'react'
import type { Suggestion } from '../../lib/inbox-thread'
import { ShimmerLabel } from '../assistant-ui/elements/surfaces'
import { Thread } from '../assistant-ui/elements/thread.aui'
import { FlatToolGroup } from '../conversation/tool-ui'
import { LiveDot } from '../LiveDot'
import { DecisionToolUI } from './DecisionToolUI'
import { FactoryMessage } from './FactoryMessage'
import { IntentToolUI } from './IntentToolUI'
import { ProposalToolUI } from './ProposalToolUI'

type Props = {
  messages: ThreadMessageLike[]
  suggestions: Suggestion[]
  sending: boolean
  placeholder: string
  threadList: ExternalStoreThreadListAdapter
  onSend: (text: string) => void
  frame: (thread: ReactNode) => ReactNode
}

const textOf = (message: { content: readonly { type: string; text?: string }[] }): string =>
  message.content.map((part) => (part.type === 'text' ? (part.text ?? '') : '')).join('')

function Sending() {
  return (
    <div role="status" className="text-muted-foreground small flex items-center gap-2 py-2">
      <LiveDot className="text-primary" />
      <ShimmerLabel>Sending to the factory</ShimmerLabel>
    </div>
  )
}

export function InboxThread({ messages, suggestions, sending, placeholder, threadList, onSend, frame }: Props) {
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages,
    isRunning: sending,
    adapters: { threadList },
    convertMessage: (message) => message,
    suggestions,
    onNew: async (message) => onSend(textOf(message)),
  })
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <DecisionToolUI />
      <IntentToolUI />
      <ProposalToolUI />
      {frame(
        <div role="log" aria-label="Conversation" className="flex flex-1 flex-col">
          <Thread
            autoFocus={false}
            components={{
              welcome: <div />,
              AssistantMessage: FactoryMessage,
              ToolGroup: FlatToolGroup,
              placeholder,
              afterMessages: sending ? <Sending /> : undefined,
            }}
          />
        </div>,
      )}
    </AssistantRuntimeProvider>
  )
}
