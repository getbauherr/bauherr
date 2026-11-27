'use client'
import type { ThreadMessageLike } from '@assistant-ui/react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { steerTicket } from '../../(shell)/inbox/steer'
import { proposalOf, type Proposal } from '../../lib/inbox-steer'
import { intentMessage, proposalMessage, userText, type ThreadModel } from '../../lib/inbox-thread'
import type { Pending } from './use-pending-decisions'

type Sent = { id: string; text: string }

type Thread = ThreadMessageLike[]

export const withOutbox = (messages: Thread, sent: Sent[], intents: Thread): Thread => {
  const own = [...sent.map((item) => userText(`sending-${item.id}`, item.text)), ...intents]
  if (own.length === 0) return messages
  const last = messages.at(-1)
  return last?.id?.startsWith('ask-') ? [...messages.slice(0, -1), ...own, last] : [...messages, ...own]
}

type Intents = { pending: Pending; recordId: number | null; proposal: Proposal | null }

export const intentsOf = ({ pending, recordId, proposal }: Intents): ThreadMessageLike[] => [
  ...(proposal ? [proposalMessage(proposal)] : []),
  ...Object.values(pending.staged)
    .filter((staged) => staged.comment !== undefined && staged.recordId === recordId)
    .map(({ key, number }) => intentMessage({ key, recordId: recordId ?? 0, number })),
]

export function useOutbox(thread: ThreadModel) {
  const router = useRouter()
  const [sent, setSent] = useState<Sent[]>([])
  const [busy, setBusy] = useState(false)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  useEffect(() => setSent([]), [thread.id, thread.messages.length])
  useEffect(() => setProposal(null), [thread.id])
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
        if (result.error) return fail(item, result.error)
        if (outcome) setProposal(proposalOf({ recordId, number }, thread.decision, outcome, String(Date.now())))
        router.refresh()
      })
      .catch(() => fail(item, 'The message was not sent.'))
      .finally(() => setBusy(false))
  }
  return { sent, busy, send, proposal, clearProposal: () => setProposal(null) }
}
