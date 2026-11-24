import type { Payload } from 'payload'
import { figuresOf, loadTickets, rangeFigures, type FigureFilter, type FigureKey, type RangeFigures } from './figures'
import { farOffFigures, farOffTickets, type FarOffTicket } from './outliers'
import { previousRange, type Range } from './range'

export const HISTORY_RANGES = 3

export type RangeReport = RangeFigures & { farOff: { figures: FigureKey[]; tickets: FarOffTicket[] } }

const earlierRanges = (range: Range): Range[] => {
  const ranges: Range[] = []
  for (let at = range; ranges.length < HISTORY_RANGES; ) {
    at = previousRange(at)
    ranges.push(at)
  }
  return ranges
}

export const rangeReport = async (payload: Payload, filter: FigureFilter): Promise<RangeReport> => {
  const current = await rangeFigures(payload, filter)
  const history = await Promise.all(
    earlierRanges(filter.range).map(async (range) => loadTickets(payload, { ...filter, range })),
  )
  const earlier = history.filter((tickets) => tickets.length > 0).map(figuresOf)
  return {
    ...current,
    farOff: {
      figures: farOffFigures(figuresOf(current.tickets), earlier),
      tickets: farOffTickets(current.tickets),
    },
  }
}
