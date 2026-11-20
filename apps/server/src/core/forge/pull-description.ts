import type { TicketRecord } from '../record/schema'

const list = (heading: string, lines: string[]): string[] =>
  lines.length === 0 ? [] : [`## ${heading}`, ...lines.map((line) => `- ${line}`), '']

export const pullTitle = (record: TicketRecord): string => {
  const goal = record.goal.replace(/\s+/g, ' ').trim()
  return goal === '' ? `Fix #${record.source.number}` : goal.slice(0, 120)
}

export const pullDescription = (record: TicketRecord): string =>
  [
    '## Goal',
    record.goal,
    '',
    ...list(
      'Acceptance criteria',
      record.criteria.map((criterion) => criterion.text),
    ),
    ...list('Out of scope', record.outOfScope),
    `Closes #${record.source.number}`,
  ].join('\n')
