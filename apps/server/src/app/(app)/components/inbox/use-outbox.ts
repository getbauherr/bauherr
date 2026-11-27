'use client'
import type { ThreadMessageLike } from '@assistant-ui/react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { commentOnRequestAction, startRequestConversation } from '../../(shell)/requests/actions'
import { userText, type ThreadModel } from '../../lib/inbox-thread'

type Sent = { id: string; text: string }

export const withOutbox = (messages: ThreadMessageLike[], sent: Sent[]): ThreadMessageLike[] => {
  if (sent.length === 0) return messages
  const own = sent.map((item) => userText(`sending-${item.id}`, item.text))
  const last = messages.at(-1)
  return last?.id?.startsWith('ask-') ? [...messages.slice(0, -1), ...own, last] : [...messages, ...own]
}

const sendTo = async (recordId: number, text: string): Promise<string | null> => {
  const conversationId = await startRequestConversation(recordId)
  const result = await commentOnRequestAction({ recordId, conversationId, text, fileIds: [] })
  return result.error ?? null
}

export function useOutbox(thread: ThreadModel) {
  const router = useRouter()
  const [sent, setSent] = useState<Sent[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => setSent([]), [thread.id, thread.messages.length])
  const fail = (item: Sent, error: string) => {
    setSent((current) => current.filter((candidate) => candidate !== item))
    toast.error(error)
  }
  const send = (text: string) => {
    const { recordId } = thread
    if (recordId === null) return void toast.error('Open a ticket to write to the factory.')
    const item = { id: String(Date.now()), text }
    setSent((current) => [...current, item])
    setBusy(true)
    sendTo(recordId, text)
      .then((error) => (error === null ? router.refresh() : fail(item, error)))
      .catch(() => fail(item, 'The comment was not sent.'))
      .finally(() => setBusy(false))
  }
  return { sent, busy, send }
}
