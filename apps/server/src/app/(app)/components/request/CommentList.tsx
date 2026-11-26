'use client'

import {
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  type TextMessagePartComponent,
  type ThreadMessageLike,
} from '@assistant-ui/react'
import type { FC } from 'react'
import type { CommentFileView, RequestComment } from '../../../../core/requests/comments'
import { Time } from '../Time'
import { CommentRuntime } from '../ticket/CommentRuntime'
import { CommentFiles } from './CommentFiles'

const ROLE_WORDS = { 'product-owner': 'product owner', bauherr: 'Bauherr' }

type CommentMeta = { author: string; role: RequestComment['role']; at: string; files: CommentFileView[] }

const toMessage = (comment: RequestComment): ThreadMessageLike => ({
  id: String(comment.id),
  role: comment.role === 'bauherr' ? 'assistant' : 'user',
  createdAt: new Date(comment.at),
  content: [{ type: 'text', text: comment.text }],
  metadata: { custom: { author: comment.author, role: comment.role, at: comment.at, files: comment.files } },
})

const CommentText: TextMessagePartComponent = ({ text }) => <p className="m-0 whitespace-pre-wrap">{text}</p>

const Comment: FC = () => {
  const meta = useAuiState((state) => state.message.metadata.custom as CommentMeta)
  const hasText = useAuiState((state) => state.message.content.some((part) => part.type === 'text' && part.text !== ''))
  return (
    <MessagePrimitive.Root data-comment className="grid gap-1 border-l-2 border-border pl-3">
      <span className="small text-muted-foreground">
        {meta.author} ({ROLE_WORDS[meta.role]}) · <Time iso={meta.at} />
      </span>
      {hasText && <MessagePrimitive.Parts components={{ Text: CommentText }} />}
      <CommentFiles files={meta.files} />
    </MessagePrimitive.Root>
  )
}

export function CommentList({ comments }: { comments: RequestComment[] }) {
  if (comments.length === 0) return null
  return (
    <section aria-label="Conversation so far" className="grid gap-3">
      <h3 className="label text-muted-foreground">Comments</h3>
      <CommentRuntime messages={comments.map(toMessage)}>
        <ThreadPrimitive.Root className="grid gap-3">
          <ThreadPrimitive.Messages components={{ UserMessage: Comment, AssistantMessage: Comment }} />
        </ThreadPrimitive.Root>
      </CommentRuntime>
    </section>
  )
}
