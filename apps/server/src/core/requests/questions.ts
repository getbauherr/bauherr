import { z } from 'zod'
import { fieldKeys, MAX_QUESTIONS_PER_ROUND, MAX_ROUNDS, readiness, type Fields } from './fields'
import { QuestionsRefused } from './errors'
import type { RecordType } from '../record/schema'

const text = (max: number) => z.string().trim().min(1).max(max)

export const questionSchema = z.object({
  field: text(40),
  text: text(200),
  options: z.array(text(80)).min(2).max(4),
  suggested: text(80),
})

export type RequestQuestion = z.infer<typeof questionSchema>

export const PROBLEM_QUESTION: RequestQuestion = {
  field: 'problem',
  text: 'What are you trying to get done when you need this, and what is in the way today?',
  options: ['A task takes too long by hand', 'Something is missing for a customer', 'Something else'],
  suggested: 'A task takes too long by hand',
}

export const acceptRound = (rounds: number, questions: RequestQuestion[]): RequestQuestion[] => {
  if (questions.length === 0) return questions
  if (rounds >= MAX_ROUNDS) {
    throw new QuestionsRefused(`The factory asked ${MAX_ROUNDS} rounds already: it asks no third round.`)
  }
  if (questions.length > MAX_QUESTIONS_PER_ROUND) {
    throw new QuestionsRefused(`A round holds at most ${MAX_QUESTIONS_PER_ROUND} questions, not ${questions.length}.`)
  }
  const bad = questions.find((q) => !q.options.includes(q.suggested))
  if (bad) throw new QuestionsRefused(`The question "${bad.text}" needs a suggested answer from its options.`)
  return questions
}

export const problemFirst = (
  type: RecordType,
  fields: Fields,
  rounds: number,
  questions: RequestQuestion[],
): RequestQuestion[] => {
  if (type !== 'change' || rounds > 0 || readiness(type, fields).missing.every((m) => m.key !== 'problem')) {
    return questions
  }
  const rest = questions.filter((q) => q.field !== 'problem')
  const own = questions.find((q) => q.field === 'problem')
  return [own ?? PROBLEM_QUESTION, ...rest].slice(0, MAX_QUESTIONS_PER_ROUND)
}

export const stillMissing = (type: RecordType, fields: Fields, questions: RequestQuestion[]): RequestQuestion[] => {
  const keys = fieldKeys(type)
  const missing = new Set(readiness(type, fields).missing.map((m) => m.key))
  return questions.filter((q) => keys.includes(q.field) && missing.has(q.field))
}
