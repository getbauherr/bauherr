'use client'
import { useRouter } from 'next/navigation'
import { useState, useTransition, type FormEvent } from 'react'
import { sendMessageAction } from '../../(shell)/memory/retro/actions'
import { Button } from '../ui/button'
import { Textarea } from '../ui/textarea'

export function RetroComposer({ retro }: { retro: number }) {
  const router = useRouter()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const send = (event: FormEvent) => {
    event.preventDefault()
    start(async () => {
      const result = await sendMessageAction(retro, text)
      setError(result.error ?? null)
      if (!result.error) setText('')
      router.refresh()
    })
  }
  return (
    <form onSubmit={send} className="grid gap-2">
      <label className="small grid gap-1">
        Answer the factory or ask a question
        <Textarea value={text} onChange={(event) => setText(event.target.value)} rows={3} disabled={pending} />
      </label>
      {error && (
        <p role="alert" className="small m-0 text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || text.trim() === ''}>
          Send
        </Button>
        {pending && (
          <span role="status" className="small text-muted-foreground">
            The factory is answering...
          </span>
        )}
      </div>
    </form>
  )
}
