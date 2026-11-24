import { SECTIONS } from '../../../core/memory-sections'

export type Problem = { line: number; from: number; to: number; message: string }

export const TICKET_NUMBER_MESSAGE = 'Ticket numbers belong in the ticket. Remove the number from this line.'
export const HEADING_MESSAGE = `Headings are fixed: use ## ${SECTIONS.join(', ## ')}.`

const TICKET_NUMBER = /#\d+/g
const HEADING = /^#{1,6}\s/
const FENCE = /^\s*```/

const isStageHeading = (text: string): boolean => SECTIONS.some((section) => text.trimEnd() === `## ${section}`)

export const lineCount = (body: string): number => (body === '' ? 0 : body.replace(/\n$/, '').split('\n').length)

export const linesOver = (body: string, max: number): number => Math.max(0, lineCount(body) - max)

export const problemsOf = (body: string): Problem[] => {
  const problems: Problem[] = []
  let fenced = false
  let offset = 0
  body.split('\n').forEach((text, index) => {
    const line = index + 1
    if (FENCE.test(text)) fenced = !fenced
    else if (!fenced) {
      if (HEADING.test(text) && !isStageHeading(text)) {
        problems.push({ line, from: offset, to: offset + text.length, message: HEADING_MESSAGE })
      }
      for (const match of text.matchAll(TICKET_NUMBER)) {
        const from = offset + match.index
        problems.push({ line, from, to: from + match[0].length, message: TICKET_NUMBER_MESSAGE })
      }
    }
    offset += text.length + 1
  })
  return problems
}
