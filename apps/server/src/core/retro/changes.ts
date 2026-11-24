import type { DocumentChange, Outcome, OutcomeChange } from './schema'

const trimmed = (body: string): string[] => (body === '' ? [] : body.replace(/\n+$/, '').split('\n'))

const sectionEnd = (lines: string[], heading: number): number => {
  const next = lines.findIndex((line, index) => index > heading && /^## /.test(line))
  const end = next === -1 ? lines.length : next
  let last = end
  while (last > heading + 1 && lines[last - 1]?.trim() === '') last--
  return last
}

const insertInto = (lines: string[], change: DocumentChange): string[] => {
  const heading = lines.findIndex((line) => line.trim() === `## ${change.section}`)
  if (heading === -1) return [...lines, ...(lines.length > 0 ? [''] : []), `## ${change.section}`, change.add]
  const at = sectionEnd(lines, heading)
  return [...lines.slice(0, at), change.add, ...lines.slice(at)]
}

export const applyChange = (body: string, change: DocumentChange): string => {
  const lines = trimmed(body)
  const target = change.remove === null ? -1 : lines.findIndex((line) => line.trim() === change.remove?.trim())
  const next =
    target === -1 ? insertInto(lines, change) : lines.map((line, index) => (index === target ? change.add : line))
  return `${next.join('\n')}\n`
}

export const applyKept = (base: string, changes: OutcomeChange[]): string =>
  changes.filter((change) => change.decision === 'keep').reduce(applyChange, base)

export const undecidedCount = (outcome: Outcome): number =>
  outcome.documents.flatMap((document) => document.changes).filter((change) => change.decision === 'undecided')
    .length + outcome.tickets.filter((ticket) => ticket.decision === 'undecided').length
