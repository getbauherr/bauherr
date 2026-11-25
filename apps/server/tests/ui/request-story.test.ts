import { cleanup, render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { NowBox } from '../../src/app/(app)/components/request/NowBox'
import { RequestTimeline } from '../../src/app/(app)/components/request/RequestTimeline'
import { REQUEST_WORDS } from '../../src/app/(app)/lib/request-words'
import { STATUSES } from '../../src/core/views/status'
import type { RequestStory, StoryEvent } from '../../src/core/views/request-story'

afterEach(cleanup)

const event = (partial: Partial<StoryEvent> & Pick<StoryEvent, 'id' | 'kind' | 'at' | 'title'>): StoryEvent => ({
  who: 'Factory',
  text: '',
  images: [],
  lists: [],
  ...partial,
})

const LONG = 'Please top left, that is where the Klimapakt logo sits on our paper reports. '.repeat(5).trim()

const story = (status: RequestStory['status'], events: StoryEvent[]): RequestStory => ({
  recordId: 1,
  number: 848,
  title: 'The logo on the report',
  status,
  ended: null,
  events,
  about: { type: 'Change', by: 'Anna', created: '2026-11-24T16:40:00Z', product: 'Klimaportal' },
  links: { issue: 'https://forge/848', staging: 'https://staging.example.com/x' },
})

const waiting = story('brief-needs-approval', [
  event({ id: 'sent', kind: 'sent', at: '2026-11-24T16:40:00Z', who: 'Anna', title: 'Request sent' }),
  event({
    id: 'plan',
    kind: 'plan',
    at: '2026-11-25T10:05:00Z',
    title: 'The plan',
    text: 'The report shows the logo.',
    images: [{ id: 7, caption: 'Report page 1' }],
    lists: [{ heading: 'What will be checked', items: ['A report with a logo shows it'] }],
  }),
  event({ id: 'comment-1', kind: 'comment', at: '2026-11-25T10:21:00Z', who: 'Anna', title: 'Comment', text: LONG }),
])

const ready = story('result-ready', [
  event({ id: 'sent', kind: 'sent', at: '2026-11-19T10:00:00Z', who: 'You', title: 'Request sent' }),
  event({
    id: 'ready',
    kind: 'ready',
    at: '2026-11-21T09:00:00Z',
    title: 'Ready to try',
    images: [
      { id: 11, caption: 'Before: Report, 1280 px' },
      { id: 12, caption: 'After: Report, 1280 px' },
    ],
    lists: [{ heading: 'What was checked', items: ['✓ the year is in the title'] }],
  }),
])

describe('the Now box', () => {
  it('says what happens and whose turn it is while the plan waits', () => {
    const { getByRole, getByText } = render(createElement(NowBox, { story: waiting }))
    expect(getByRole('heading', { name: 'Now' })).toBeTruthy()
    expect(getByText(/waits for approval by a Bauherr/)).toBeTruthy()
    expect(getByText("A Bauherr's turn")).toBeTruthy()
  })

  it('asks to try it on staging when the result is ready, with the staging link', () => {
    const { getByText, getByRole } = render(createElement(NowBox, { story: ready }))
    expect(getByText(/Try it on staging/)).toBeTruthy()
    expect(getByText('Your turn')).toBeTruthy()
    expect(getByRole('link', { name: 'Open on staging' }).getAttribute('href')).toBe('https://staging.example.com/x')
  })

  it('has a chip word for every status', () => {
    expect(REQUEST_WORDS['brief-needs-approval'].chip.word).toBe('Plan waiting for approval')
    expect(REQUEST_WORDS['result-ready'].chip.word).toBe('Ready to try')
    expect(STATUSES.every((status) => REQUEST_WORDS[status].chip.word !== '')).toBe(true)
  })
})

describe('the story', () => {
  it('lists the events in the order given and shows a comment in full', () => {
    const { container } = render(createElement(RequestTimeline, { story: waiting }))
    const kinds = Array.from(container.querySelectorAll('[data-event]')).map((node) => node.getAttribute('data-event'))
    expect(kinds).toEqual(['sent', 'plan', 'comment'])
    expect(container.textContent).toContain(LONG)
  })

  it('shows the mockups and what will be checked on the plan', () => {
    const { container, getByText } = render(createElement(RequestTimeline, { story: waiting }))
    expect(getByText('What will be checked')).toBeTruthy()
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/attachments/7')
  })

  it('shows before and after with the checks on the result, from the same attachment URLs', () => {
    const { container, getByText } = render(createElement(RequestTimeline, { story: ready }))
    const sources = Array.from(container.querySelectorAll('img')).map((img) => img.getAttribute('src'))
    expect(sources).toEqual(['/api/attachments/11', '/api/attachments/12'])
    expect(getByText('What was checked')).toBeTruthy()
    expect(getByText('✓ the year is in the title')).toBeTruthy()
  })

  it('names no runs, agents, review rounds, cost or code', () => {
    const { container } = render(createElement(RequestTimeline, { story: ready }))
    const page = render(createElement(NowBox, { story: ready })).container
    const words = /\b(runs?|agents?|reviews?|rounds?|cost|code|diff)\b/i
    expect(`${container.textContent} ${page.textContent}`).not.toMatch(words)
  })
})
