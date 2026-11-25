import { describe, expect, it } from 'vitest'
import { FIELDS, readiness } from '../../src/core/requests/fields'
import { QuestionsRefused } from '../../src/core/requests/errors'
import { acceptRound, PROBLEM_QUESTION, problemFirst, type RequestQuestion } from '../../src/core/requests/questions'

const ask = (field: string, suggested = 'a'): RequestQuestion => ({
  field,
  text: `${field}?`,
  options: ['a', 'b'],
  suggested,
})

describe('readiness', () => {
  const bug = {
    happened: 'It stops',
    expected: 'A file',
    steps: 'Press Export',
    where: 'Export',
    frequency: 'Every time',
  }

  it('is complete for a bug with what happened, expected, steps, where and how often', () => {
    expect(readiness('bug', bug)).toEqual({ complete: true, missing: [] })
  })

  it('names the missing fields of a bug, a change, a question and a routine request', () => {
    expect(readiness('bug', { happened: 'It stops' }).missing.map((m) => m.key)).toEqual([
      'expected',
      'steps',
      'where',
      'frequency',
    ])
    expect(readiness('change', { who: '  ' }).missing.map((m) => m.key)).toEqual(['who', 'problem', 'acceptance'])
    expect(readiness('question', { question: 'When?' }).complete).toBe(true)
    expect(readiness('chore', { what: 'Update the text' }).missing).toEqual([FIELDS.chore[1]])
  })
})

describe('question limits', () => {
  it('accepts up to 3 questions in each of the first 2 rounds', () => {
    expect(acceptRound(0, [ask('a'), ask('b'), ask('c')])).toHaveLength(3)
    expect(acceptRound(1, [ask('a')])).toHaveLength(1)
  })

  it('refuses a fourth question in a round', () => {
    expect(() => acceptRound(0, [ask('a'), ask('b'), ask('c'), ask('d')])).toThrow(QuestionsRefused)
  })

  it('refuses a third round', () => {
    expect(() => acceptRound(2, [ask('a')])).toThrow(QuestionsRefused)
  })

  it('refuses a question whose suggestion is not one of its options', () => {
    expect(() => acceptRound(0, [ask('a', 'z')])).toThrow(QuestionsRefused)
  })
})

describe('problem before solution', () => {
  it('puts the problem question first for a change whose problem is missing', () => {
    const asked = problemFirst('change', { who: 'Anna' }, 0, [ask('who'), ask('acceptance')])
    expect(asked.map((q) => q.field)).toEqual(['problem', 'who', 'acceptance'])
    expect(asked[0]).toEqual(PROBLEM_QUESTION)
  })

  it('leaves a change with a known problem and later rounds alone', () => {
    expect(problemFirst('change', { problem: 'x' }, 0, [ask('who')])).toHaveLength(1)
    expect(problemFirst('change', {}, 1, [ask('who')]).map((q) => q.field)).toEqual(['who'])
  })
})
