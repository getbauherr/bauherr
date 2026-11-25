import { z } from 'zod'
import { TYPES } from '../record/schema'
import { RequestInvalid } from './errors'
import { FIELDS, readiness, type Fields } from './fields'
import { questionSchema } from './questions'
import type { DraftData } from './store'

const text = (max: number) => z.string().trim().min(1).max(max)

export const replySchema = z.object({
  reply: text(1500),
  type: z.enum(TYPES),
  confirm: text(200).optional(),
  title: z.string().trim().max(120).default(''),
  summary: z.string().trim().max(400).default(''),
  fields: z.record(z.string(), z.string()).default({}),
  questions: z.array(questionSchema).default([]),
  answer: text(1500).optional(),
})

export type ModelReply = z.infer<typeof replySchema>

export const RETRY_LINE =
  'Your last reply was not valid: answer with one JSON object only, at most 3 questions, ' +
  'each with options and one suggested option.'

export const parseReply = (raw: string): ModelReply => {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end < start) throw new RequestInvalid('The model did not answer with JSON.')
  try {
    return replySchema.parse(JSON.parse(raw.slice(start, end + 1)))
  } catch (error) {
    throw new RequestInvalid(`The model's reply does not fit: ${error instanceof Error ? error.message : 'unknown'}`)
  }
}

export const contextOf = (data: DraftData): string => {
  const type = data.type
  return JSON.stringify({
    type,
    typeConfirmed: data.typeConfirmed,
    rounds: data.rounds,
    title: data.title,
    fields: data.fields,
    fieldsPerType: Object.fromEntries(Object.entries(FIELDS).map(([name, list]) => [name, list.map((f) => f.key)])),
    missing: type === null ? [] : readiness(type, data.fields as Fields).missing.map((m) => m.key),
  })
}
