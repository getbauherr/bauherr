import { describe, expect, it } from 'vitest'
import { decisionOf } from '../../src/app/(app)/lib/inbox-decision'
import { threadOf } from '../../src/app/(app)/lib/inbox-thread'
import { cardOf, need, criterion, refsOf, source, sourceOf } from '../helpers/ticket-source'
import { emptyRecord } from '../../src/core/record/schema'

const brief = cardOf('brief', 'one-way-door', [], 2)
const event = (id: number, actor: 'owner' | 'factory', label: string) => ({
  id,
  type: 'brief.approved' as const,
  actor,
  at: new Date().toISOString(),
  label,
})

const textOf = (message: { content: unknown }): string =>
  Array.isArray(message.content) ? message.content.map((part: { text?: string }) => part.text ?? '').join('') : ''

describe('thread of a ticket', () => {
  it('omits what you decided before when the owner decided nothing', () => {
    const thread = threadOf(sourceOf(null, { events: [event(1, 'factory', 'Approved by rule')] }), refsOf())
    expect(thread.messages.map((m) => m.id)).toEqual(['status-126'])
    expect(thread.decision).toBeNull()
  })

  it('lists owner decisions as you and puts the pending decision last', () => {
    const view = sourceOf(brief, { events: [event(1, 'owner', 'The owner approved the Brief')] })
    const thread = threadOf(view, refsOf())
    expect(textOf(thread.messages[0])).toContain('What you decided before')
    expect(textOf(thread.messages[0])).toContain('You approved the Brief')
    expect(thread.messages.at(-1)?.id).toBe(`ask-${thread.decision?.key}`)
    expect(thread.suggestions.length).toBeGreaterThan(0)
  })

  it('lists a Result the factory accepted apart from what the owner decided', () => {
    const accepted = {
      ...event(2, 'factory', 'Accepted by the factory: two-way, 4/4 met, send-back 6 %'),
      type: 'result.accepted' as const,
    }
    const events = [event(1, 'owner', 'The owner approved the Brief'), accepted]
    const thread = threadOf(sourceOf(null, { events }), refsOf())
    expect(thread.messages.map((m) => m.id)).toEqual(['decided-126', 'factory-126', 'status-126'])
    expect(textOf(thread.messages[0])).not.toContain('Accepted by the factory')
    expect(textOf(thread.messages[1])).toContain('Accepted by the factory: two-way, 4/4 met, send-back 6 %')
  })

  it('links every #ref to its ticket page', () => {
    const view = sourceOf(null, { events: [event(1, 'owner', 'The owner moved #12 ahead of #99')] })
    const text = textOf(threadOf(view, refsOf({ recordId: 7, number: 12 })).messages[0])
    expect(text).toContain('[`#12`](/tickets/7)')
    expect(text).toContain('#99')
    expect(text).not.toContain('(/tickets/99)')
  })

  it('shows comments of the owner as your messages', () => {
    const comments = [{ id: 5, at: '', author: 'Me', role: 'bauherr' as const, text: 'Please check c3', files: [] }]
    const roles = threadOf(sourceOf(null, { comments }), refsOf()).messages.map((m) => m.role)
    expect(roles).toEqual(['assistant', 'user'])
  })
})

describe('decision model', () => {
  it('has exactly one primary, a ghost discard and a note for changes', () => {
    const model = need(decisionOf(sourceOf(brief)))
    expect(model.options.filter((o) => o.tier === 'primary').map((o) => o.choice)).toEqual(['approve'])
    expect(model.options.find((o) => o.choice === 'discard')?.tier).toBe('ghost')
    expect(model.options.find((o) => o.choice === 'request-changes')?.note?.required).toBe(true)
    expect(model.criteria).toBeNull()
  })

  it('renders the criteria picker with the unmet criteria ticked when drop-criteria is offered', () => {
    const record = {
      ...emptyRecord(source, 'change'),
      criteria: [criterion('c1', 'met'), criterion('c2', 'missing')],
      dropped: [{ id: 'c3', text: 'Criterion c3', note: 'out of scope' }],
    }
    const card = cardOf('question', 'verify-rounds', ['drop-criteria', 'accept-anyway', 'one-more-round', 'discard'])
    const model = need(decisionOf(sourceOf(card, { record })))
    expect(model.options.filter((o) => o.tier === 'primary').map((o) => o.choice)).toEqual(['drop-criteria'])
    expect(model.criteria).toEqual({
      active: [{ id: 'c1', text: 'Criterion c1' }, { id: 'c2', text: 'Criterion c2' }],
      dropped: [{ id: 'c3', text: 'Criterion c3' }],
      suggested: ['c2'],
    })
  })

  it('does not offer criteria options before the factory sends them', () => {
    const card = cardOf('question', 'verify-rounds', ['one-more-round', 'discard'])
    const model = need(decisionOf(sourceOf(card)))
    expect(model.criteria).toBeNull()
    expect(model.options.map((o) => o.tier)).toEqual(['primary', 'ghost'])
  })
})
