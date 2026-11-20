import { FakeBackend } from '@bauherr/adapters'
import { describe, expect, it } from 'vitest'
import { DISCLOSURE } from '../../src/core/forge/disclosure'
import { intakeFacts, missingFields, REQUIRED_FIELDS, sectionsOf } from '../../src/core/intake/facts'
import { loadIntakeFacts } from '../../src/core/intake/facts-store'
import { questionsBody } from '../../src/core/intake/questions'
import { createRecord, readRecord } from '../../src/core/record/store'
import { mirrorHarness, readerOf } from './mirror-harness'

const FORM = [
  '### What happened',
  'The list is empty.',
  '',
  '### What was expected',
  '_No response_',
  '',
  '### Steps to reproduce',
  '1. open it',
  '2. look',
].join('\n')

describe('missing required fields', () => {
  it('lists the fields of the type whose section is absent or empty', () => {
    expect(missingFields('bug', FORM)).toEqual(['what was expected', 'where'])
  })

  it('reads labelled lines as well as headings', () => {
    const body = 'Who needs it: the support team\n**What:** a filter\n**Why:**'
    expect(missingFields('feature', body)).toEqual(['why'])
    expect(sectionsOf(body).get('what')).toBe('a filter')
  })

  it('has one constant with a list per type, and none are missing for a chore', () => {
    expect(Object.keys(REQUIRED_FIELDS).sort()).toEqual(['bug', 'change', 'chore', 'feature'])
    expect(missingFields('chore', '')).toEqual([])
    expect(missingFields('change', '')).toEqual(REQUIRED_FIELDS.change)
  })
})

describe('intakeFacts', () => {
  const asked = (round: number, at: string) => ({
    author: 'bot',
    body: `${DISCLOSURE}\n\n${questionsBody(round, [{ text: 'Which browser?', suggested: 'Firefox' }])}`,
    createdAt: at,
  })
  const comments = [
    { author: 'jo', body: 'before', createdAt: '2026-11-01T08:00:00Z' },
    asked(1, '2026-11-01T10:00:00Z'),
    { author: 'jo', body: 'Firefox', createdAt: '2026-11-01T11:00:00Z' },
    { author: 'other', body: 'me too', createdAt: '2026-11-01T11:30:00Z' },
    asked(2, '2026-11-02T10:00:00Z'),
    { author: 'jo', body: 'yes', createdAt: '2026-11-02T12:00:00Z' },
  ]
  const similar = Array.from({ length: 7 }, (_, n) => ({ number: n + 1, title: `t${n}`, state: 'open' }))

  it('pairs each question round with the reporter replies up to the next round', () => {
    const facts = intakeFacts({ type: 'bug', body: FORM, reporter: 'jo', comments, similar })
    expect(facts.rounds.map((r) => [r.round, r.replies])).toEqual([
      [1, ['Firefox']],
      [2, ['yes']],
    ])
    expect(facts.rounds[0]?.questions).toContain('1. Which browser?')
  })

  it('keeps the five most similar items and their state', () => {
    const facts = intakeFacts({ type: 'bug', body: FORM, reporter: 'jo', comments: [], similar })
    expect(facts.similar.map((s) => s.number)).toEqual([1, 2, 3, 4, 5])
    expect(facts.rounds).toEqual([])
    expect(facts.missing).toEqual(['what was expected', 'where'])
  })
})

describe('loadIntakeFacts', () => {
  const h = mirrorHarness('core_intake_facts')

  it('reads the issue, its comments and the similar items from the mirror', async () => {
    const repo = h.fresh()
    const fake = new FakeBackend({ native: true, user: 'jo' })
    const issue = await fake.tickets(repo).create({ title: 'list is empty', body: FORM, labels: ['bug'] })
    await fake.tickets(repo).create({ title: 'list is empty on friday', body: 'same' })
    await fake.tickets(repo).comment(issue.id, 'still happens')
    await h.sync({ [repo]: readerOf(fake) })
    const { number } = issue
    const source = { forge: 'github' as const, repo, number, reporter: 'jo', external: false, backlog: false }
    const { workspace, product } = h.ids
    const created = await createRecord(h.payload(), { workspace, product, source, type: 'bug' })
    const facts = await loadIntakeFacts(h.payload(), await readRecord(h.payload(), created.id))
    expect(facts.missing).toEqual(['what was expected', 'where'])
    expect(facts.similar.map((s) => s.title)).toEqual(['list is empty on friday'])
    expect(facts.rounds).toEqual([])
  })
})
