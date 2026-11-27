'use client'
import type { ThreadMessageLike } from '@assistant-ui/react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { steerTicket } from '../../(shell)/inbox/steer'
import { stagedOf } from '../../lib/inbox-steer'
import { intentMessage, userText, type ThreadModel } from '../../lib/inbox-thread'
import type { Pending } from './use-pending-decisions'

type Sent = { id: string; text: string }

type Thread = ThreadMessageLike[]

export const withOutbox = (messages: Thread, sent: Sent[], intents: Thread): Thread => {
  const own = [...sent.map((item) => userText(`sending-${item.id}`, item.text)), ...intents]
  if (own.length === 0) return messages
  const last = messages.at(-1)
  return last?.id?.startsWith('ask-') ? [...messages.slice(0, -1), ...own, last] : [...messages, ...own]
}

export const intentsOf = (pending: Pending, recordId: number | null): ThreadMessageLike[] =>
  Object.values(pending.staged)
    .filter((staged) => staged.comment !== undefined && staged.recordId === recordId)
    .map(({ key, number }) => intentMessage({ key, recordId: recordId ?? 0, number }))

export function useOutbox(thread: ThreadModel, pending: Pending) {
  const router = useRouter()
  const [sent, setSent] = useState<Sent[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => setSent([]), [thread.id, thread.messages.length])
  const fail = (item: Sent, error: string) => {
    setSent((current) => current.filter((candidate) => candidate !== item))
    toast.error(error)
  }
  const send = (text: string) => {
    const { recordId, number } = thread
    if (recordId === null || number === null) return void toast.error('Open a ticket to write to the factory.')
    const item = { id: String(Date.now()), text }
    setSent((current) => [...current, item])
    setBusy(true)
    steerTicket({ recordId, text })
      .then((result) => {
        const { outcome } = result
        const error = result.error ?? (outcome?.kind === 'fallback' ? outcome.error : null)
        if (error) return fail(item, error)
        const staged = outcome ? stagedOf({ recordId, number }, outcome, Date.now()) : null
        if (staged) pending.stage(staged)
        router.refresh()
      })
      .catch(() => fail(item, 'The message was not sent.'))
      .finally(() => setBusy(false))
  }
  return { sent, busy, send }
}
