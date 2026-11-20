import { DISCLOSURE } from '../forge/disclosure'
import type { RecordType } from '../record/schema'
import { QUESTIONS_HEADING } from './questions'

export const REQUIRED_FIELDS: Record<RecordType, string[]> = {
  bug: ['what happened', 'what was expected', 'steps to reproduce', 'where'],
  feature: ['who needs it', 'what', 'why'],
  change: ['who needs it', 'what', 'why'],
  chore: [],
}

export const SIMILAR_LIMIT = 5

export type FactsComment = { author: string; body: string; createdAt: string }
export type FactsSimilar = { number: number; title: string; state: string }
export type FactsRound = { round: number; questions: string; replies: string[] }
export type IntakeFacts = { missing: string[]; similar: FactsSimilar[]; rounds: FactsRound[] }
export type FactsInput = {
  type: RecordType
  body: string
  reporter: string
  comments: FactsComment[]
  similar: FactsSimilar[]
}

const HEADING = /^#{1,6}\s*(.+?)\s*#*$/
const LABEL = /^(?:[-*]\s*)?\**([^:*\n]{2,40}?)\**\s*:\s*\**\s*(.*)$/
const EMPTY = /^_?no response_?$/i

export const sectionsOf = (body: string): Map<string, string> => {
  const sections = new Map<string, string>()
  let current: string | null = null
  for (const line of body.split('\n')) {
    const heading = HEADING.exec(line.trim())
    const label = heading ? null : LABEL.exec(line.trim())
    if (heading?.[1]) {
      current = heading[1].toLowerCase()
      sections.set(current, '')
    } else if (label?.[1]) {
      current = null
      sections.set(label[1].toLowerCase().trim(), label[2] ?? '')
    } else if (current !== null) {
      sections.set(current, `${sections.get(current) ?? ''}\n${line}`.trim())
    }
  }
  return sections
}

export const missingFields = (type: RecordType, body: string): string[] => {
  const sections = [...sectionsOf(body)].map(([name, text]) => ({ name, text: text.trim() }))
  return REQUIRED_FIELDS[type].filter(
    (field) => !sections.some((s) => s.name.includes(field) && s.text !== '' && !EMPTY.test(s.text)),
  )
}

const isFactory = (comment: FactsComment): boolean => comment.body.trimStart().startsWith(DISCLOSURE)

const questionText = (comment: FactsComment): string => comment.body.trimStart().slice(DISCLOSURE.length).trim()

export const roundsOf = (reporter: string, comments: FactsComment[]): FactsRound[] => {
  const ordered = [...comments].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
  const asked = ordered.filter((c) => isFactory(c) && QUESTIONS_HEADING.test(questionText(c)))
  return asked.map((comment, i) => {
    const until = asked[i + 1]?.createdAt ?? null
    const replies = ordered.filter(
      (c) =>
        c.author === reporter &&
        !isFactory(c) &&
        Date.parse(c.createdAt) > Date.parse(comment.createdAt) &&
        (until === null || Date.parse(c.createdAt) < Date.parse(until)),
    )
    const round = Number(QUESTIONS_HEADING.exec(questionText(comment))?.[1] ?? i + 1)
    return { round, questions: questionText(comment), replies: replies.map((c) => c.body) }
  })
}

export const intakeFacts = (input: FactsInput): IntakeFacts => ({
  missing: missingFields(input.type, input.body),
  similar: input.similar.slice(0, SIMILAR_LIMIT),
  rounds: roundsOf(input.reporter, input.comments),
})
