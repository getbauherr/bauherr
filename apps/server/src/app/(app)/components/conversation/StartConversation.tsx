'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button } from '../ui/button'
import { conversationApi } from './conversation-api'

const api = conversationApi()

export function StartConversation({ workspace }: { workspace: number }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const begin = () =>
    start(async () => {
      try {
        router.push(`/conversations/${await api.create(workspace, 'Test conversation')}`)
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'The conversation was not started.')
      }
    })
  return (
    <div className="grid justify-items-start gap-2">
      <Button type="button" disabled={pending} onClick={begin}>
        Start a conversation
      </Button>
      {error && (
        <p role="alert" className="small m-0 text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
