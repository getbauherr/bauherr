import type { ReactNode } from 'react'
import type { BoardCard } from '../../../../core/views/board'
import { isDimmed, whoOf, type Show } from '../../lib/factory'
import { TicketCard } from './TicketCard'
import type { Item } from './useOrder'

export const itemOf = (card: BoardCard, show: Show): Item<ReactNode> => ({
  id: card.recordId,
  label: `#${card.number} ${card.title}`,
  dimmed: isDimmed(show, whoOf(card)),
  node: <TicketCard card={card} />,
})
