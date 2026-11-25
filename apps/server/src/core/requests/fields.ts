import type { RecordType } from '../record/schema'

export type FieldSpec = { key: string; label: string }

export const FIELDS: Record<RecordType, FieldSpec[]> = {
  bug: [
    { key: 'happened', label: 'What happened' },
    { key: 'expected', label: 'What was expected' },
    { key: 'steps', label: 'Steps to reproduce' },
    { key: 'where', label: 'Where' },
    { key: 'frequency', label: 'How often' },
  ],
  change: [
    { key: 'who', label: 'Who needs it' },
    { key: 'problem', label: 'What they are trying to get done, and what is in the way' },
    { key: 'acceptance', label: 'How they will know it works' },
  ],
  question: [{ key: 'question', label: 'The question' }],
  chore: [
    { key: 'what', label: 'What exactly' },
    { key: 'where', label: 'Where' },
  ],
}

export const TYPE_WORDS: Record<RecordType, string> = {
  bug: 'Something is broken (bug)',
  change: 'Something new or different (change)',
  question: 'A question',
  chore: 'A routine request',
}

export const MAX_QUESTIONS_PER_ROUND = 3
export const MAX_ROUNDS = 2

export type Fields = Record<string, string>
export type Readiness = { complete: boolean; missing: FieldSpec[] }

const filled = (value: string | undefined): boolean => (value ?? '').trim() !== ''

export const readiness = (type: RecordType, fields: Fields): Readiness => {
  const missing = FIELDS[type].filter((field) => !filled(fields[field.key]))
  return { complete: missing.length === 0, missing }
}

export const fieldKeys = (type: RecordType): string[] => FIELDS[type].map((field) => field.key)
