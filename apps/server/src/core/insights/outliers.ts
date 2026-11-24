import { median } from '../views/insights'
import { FIGURE_KEYS, type FigureKey, type Figures, type TicketFacts } from './figures'

export const FIGURE_FACTOR = 2
export const TICKET_MARGIN = 1
export const TICKET_PERCENTILE = 0.9
export const MIN_OTHER_TICKETS = 3

export const TICKET_METRICS = ['verifyRounds', 'sendBacks', 'failedRuns', 'questions'] as const
export type TicketMetric = (typeof TICKET_METRICS)[number]
export type FarOffTicket = { recordId: number; metric: TicketMetric; value: number; limit: number }

export const isFigureFarOff = (value: number | null, earlier: (number | null)[]): boolean => {
  const reference = median(earlier.filter((entry): entry is number => entry !== null))
  return value !== null && reference !== null && reference > 0 && value > FIGURE_FACTOR * reference
}

export const farOffFigures = (current: Figures, earlier: Figures[]): FigureKey[] =>
  FIGURE_KEYS.filter((key) =>
    isFigureFarOff(
      current[key],
      earlier.map((figures) => figures[key]),
    ),
  )

const percentile = (values: number[], share: number): number => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(share * sorted.length) - 1)] ?? 0
}

export const farOffTickets = (tickets: TicketFacts[]): FarOffTicket[] => {
  const found: FarOffTicket[] = []
  for (const metric of TICKET_METRICS) {
    for (const ticket of tickets) {
      const others = tickets.filter((other) => other !== ticket).map((other) => other[metric])
      if (others.length < MIN_OTHER_TICKETS) continue
      const limit = percentile(others, TICKET_PERCENTILE) + TICKET_MARGIN
      if (ticket[metric] > limit) found.push({ recordId: ticket.recordId, metric, value: ticket[metric], limit })
    }
  }
  return found
}
