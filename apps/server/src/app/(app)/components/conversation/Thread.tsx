'use client'

import { MessagePrimitive, ThreadPrimitive } from '@assistant-ui/react'
import { MarkdownText } from '../assistant-ui/elements/markdown-text'
import { UserMessageAttachments } from '../assistant-ui/elements/attachment.aui'
import { Composer } from './Composer'

function UserMessage() {
  return (
    <MessagePrimitive.Root data-role="user" className="ml-auto flex max-w-[85%] flex-col items-end gap-2">
      <UserMessageAttachments />
      <div className="rounded-md bg-muted px-3 py-2 whitespace-pre-wrap">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  )
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root data-role="assistant" className="max-w-[85%]">
      <MessagePrimitive.Parts components={{ Text: MarkdownText }} />
    </MessagePrimitive.Root>
  )
}

export function Thread({ error }: { error: string | null }) {
  return (
    <ThreadPrimitive.Root className="flex h-full min-h-0 flex-col gap-4">
      <ThreadPrimitive.Viewport className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        <ThreadPrimitive.Empty>
          <p className="small m-0 text-muted-foreground">No messages yet.</p>
        </ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
      </ThreadPrimitive.Viewport>
      {error && (
        <p role="alert" className="small m-0 text-destructive">
          {error}
        </p>
      )}
      <Composer placeholder="Write a message" />
    </ThreadPrimitive.Root>
  )
}
