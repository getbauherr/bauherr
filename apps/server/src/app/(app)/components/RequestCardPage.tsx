'use client'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import type { CardData } from '../../../lib/intake/card'
import { request } from './chat/dock-state'
import { RequestCard, onCardChanged } from './RequestCard'

/** The request card on the request page: edits refresh the page and "Send to the factory" opens the dock, which shows the confirmation card. */
export function RequestCardPage({ card }: { card: CardData }) {
  const router = useRouter()
  useEffect(() => onCardChanged(card.session, () => router.refresh()), [card.session, router])
  return <RequestCard initial={card} productSelect onSend={() => request({ request: card.session, send: true })} />
}
