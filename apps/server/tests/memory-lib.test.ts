import { describe, expect, it } from 'vitest'
import { countsOf, keep, parseShow } from '../src/app/(app)/lib/memory'
import type { StatementRecord } from '../src/core/views/statement-records'

const memory = (over: Partial<StatementRecord>): StatementRecord => ({
  id: 1,
  kind: 'written',
  text: 'A rule.',
  originalText: null,
  from: 'You wrote it',
  sourceText: null,
  ticket: null,
  scope: 'product',
  applies: 'fit',
  area: null,
  reach: 'fit',
  reachLabel: 'Tickets that fit',
  stages: ['build'],
  off: false,
  handed: 0,
  ...over,
})

const ROWS = [
  memory({ id: 1 }),
  memory({ id: 2, kind: 'learned' }),
  memory({ id: 3, kind: 'learned' }),
  memory({ id: 4, kind: 'answer', off: true }),
]

const ids = (show: Parameters<typeof keep>[1]) => keep(ROWS, show).map((row) => row.id)

describe('the Memory filters', () => {
  it('keeps Agents found and You said apart, and You said excludes learned ones', () => {
    expect(ids('agents')).toEqual([2, 3])
    expect(ids('said')).toEqual([1, 4])
    expect(ids('off')).toEqual([4])
    expect(ids('all')).toEqual([1, 2, 3, 4])
  })

  it('counts every filter', () => {
    expect(countsOf(ROWS)).toEqual({ all: 4, said: 2, agents: 2, off: 1 })
  })

  it('reads the filters from the address and falls back to All', () => {
    expect(parseShow('agents')).toBe('agents')
    expect(parseShow('new')).toBe('all')
    expect(parseShow('nonsense')).toBe('all')
  })
})
