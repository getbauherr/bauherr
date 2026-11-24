import type { Payload } from 'payload'
import { FIGURE_KEYS, loadTickets, type FigureFilter, type FigureKey } from '../insights/figures'
import { rangeReport, type RangeReport } from '../insights/report'
import { runCount, ticketTitles } from './history'
import { retrosOfProduct } from './store'
import type { Opening, OpeningTicket } from './schema'

export const SHOWN_FIGURES: FigureKey[] = [
  'ticketsAccepted',
  'firstTryShare',
  'sendBacks',
  'verifyRoundsPerTicket',
  'failedRuns',
  'questions',
  'secondsToAccepted',
  'costUsd',
  'correctionsCameBack',
]

export const HISTORY_POINTS = 4

const OFF_LABEL = {
  verifyRounds: 'Many verify rounds',
  sendBacks: 'Sent back often',
  failedRuns: 'Failed runs',
  questions: 'Many questions',
}

const farOffOf = (report: RangeReport, titles: Map<number, string>): OpeningTicket[] => {
  const facts = new Map(report.tickets.map((ticket) => [ticket.recordId, ticket]))
  const grouped = new Map<number, OpeningTicket>()
  for (const found of report.farOff.tickets) {
    const ticket = facts.get(found.recordId)
    if (!ticket) continue
    const entry = grouped.get(found.recordId) ?? {
      recordId: found.recordId,
      title: titles.get(found.recordId) ?? `Ticket ${found.recordId}`,
      verifyRounds: ticket.verifyRounds,
      sendBacks: ticket.sendBacks,
      failedRuns: ticket.failedRuns,
      questions: ticket.questions,
      off: [],
    }
    entry.off.push(OFF_LABEL[found.metric])
    grouped.set(found.recordId, entry)
  }
  return [...grouped.values()]
}

export const rangePreview = async (
  payload: Payload,
  filter: FigureFilter,
): Promise<{ accepted: number; runs: number; questions: number }> => {
  const tickets = await loadTickets(payload, filter)
  return {
    accepted: tickets.length,
    runs: await runCount(
      payload,
      tickets.map((ticket) => ticket.recordId),
    ),
    questions: tickets.reduce((total, ticket) => total + ticket.questions, 0),
  }
}

export const buildOpening = async (payload: Payload, filter: FigureFilter & { product: number }): Promise<Opening> => {
  const report = await rangeReport(payload, filter)
  const earlier = (await retrosOfProduct(payload, filter.workspace, filter.product))
    .slice(0, HISTORY_POINTS)
    .reverse()
  const titles = await ticketTitles(
    payload,
    report.farOff.tickets.map((ticket) => ticket.recordId),
  )
  const keys: readonly FigureKey[] = FIGURE_KEYS
  return {
    counts: {
      accepted: report.tickets.length,
      runs: await runCount(
        payload,
        report.tickets.map((ticket) => ticket.recordId),
      ),
      questions: report.tickets.reduce((total, ticket) => total + ticket.questions, 0),
    },
    figures: SHOWN_FIGURES.filter((key) => keys.includes(key)).map((key) => ({
      key,
      value: report.figures[key].value,
      previous: report.figures[key].previous,
      history: [
        ...earlier.map((retro) => retro.opening?.figures.find((figure) => figure.key === key)?.value ?? null),
        report.figures[key].value,
      ],
      farOff: report.farOff.figures.includes(key),
    })),
    tickets: farOffOf(report, titles),
  }
}
