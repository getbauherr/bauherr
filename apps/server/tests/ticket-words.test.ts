import { describe, expect, it } from 'vitest'
import { DECISIONS } from '../src/core/decisions'
import { CHOICE_WORDS, NOTE_PROMPTS, REASON_WORDS } from '../src/app/(app)/lib/ticket-words'

const QUESTIONS = Object.keys(DECISIONS)
  .filter((ask) => ask.startsWith('question:') && ask !== 'question:agent')
  .map((ask) => ask.slice('question:'.length))
const BRIEF_REASONS = [
  'open-decision',
  'one-way-door',
  'risk-area',
  'visible-change',
  'backlog',
  'external-request',
  'sent-back',
]

describe('the words of a card', () => {
  it('has a sentence for every Brief gate reason and every question reason', () => {
    for (const reason of [...BRIEF_REASONS, ...QUESTIONS, 'production-held', 'agent']) {
      expect(REASON_WORDS[reason as keyof typeof REASON_WORDS], reason).toMatch(/\S/)
    }
    const all = [...BRIEF_REASONS, ...QUESTIONS, 'production-held', 'agent']
    expect(Object.keys(REASON_WORDS).sort()).toEqual(all.sort())
  })

  it('has a button label for every option of every decision, and for nothing else', () => {
    for (const [ask, choices] of Object.entries(DECISIONS)) {
      expect(Object.keys(CHOICE_WORDS[ask] ?? {}).sort(), ask).toEqual(Object.keys(choices).sort())
    }
    expect(Object.keys(CHOICE_WORDS).sort()).toEqual(Object.keys(DECISIONS).sort())
  })

  it('asks for a note exactly where the decision needs one', () => {
    const needing = Object.entries(DECISIONS).flatMap(([ask, choices]) =>
      Object.entries(choices).filter(([, entry]) => entry.needsNote).map(([choice]) => `${ask}/${choice}`),
    )
    expect(Object.keys(NOTE_PROMPTS).sort()).toEqual(needing.sort())
  })
})
