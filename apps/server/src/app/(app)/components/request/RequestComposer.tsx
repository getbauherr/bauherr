'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useRef, useState } from 'react'
import { commentOnRequestAction, startRequestConversation } from '../../(shell)/requests/actions'
import { Composer } from '../assistant-ui/elements/thread-composer'
import { CommentRuntime } from '../ticket/CommentRuntime'
import { Label } from '../ui/label'
import { COMMENT_FIELD } from './comment-field'

type Props = { recordId: number; placeholder?: string }

export function RequestComposer({ recordId, placeholder = 'Write a comment, add screenshots or files…' }: Props) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const conversation = useRef<Promise<number> | null>(null)
  const ensure = useCallback(() => {
    conversation.current ??= startRequestConversation(recordId).catch((failure: unknown) => {
      conversation.current = null
      throw failure
    })
    return conversation.current
  }, [recordId])
  const send = useCallback(
    async (text: string, fileIds: number[]) => {
      setError(null)
      const result = await commentOnRequestAction({ recordId, conversationId: await ensure(), text, fileIds })
      if (result.error) return setError(result.error)
      router.refresh()
    },
    [recordId, ensure, router],
  )
  return (
    <section aria-label="Conversation" className="grid gap-2">
      <Label htmlFor={COMMENT_FIELD}>Add to the conversation</Label>
      <CommentRuntime conversation={ensure} onSend={send}>
        <Composer autoFocus={false} nested field={{ id: COMMENT_FIELD, placeholder }} />
      </CommentRuntime>
      {error && (
        <p role="alert" className="small m-0 text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
