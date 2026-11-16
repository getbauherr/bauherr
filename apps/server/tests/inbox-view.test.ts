import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { emptyCopy, inboxHref, nextRow, redirectHref, resolveSelection } from '../src/app/(app)/lib/inbox-view'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {}, replace() {}, refresh() {} }) }))
vi.mock('../src/app/(app)/lib/actions', () => ({ decideAction: async () => ({}) }))

const item = (id: number, checkpoint = 'Approve plan') => ({ id, number: id + 100, product: { id: 1, name: 'web' }, decision: { need: 'Approve plan', checkpoint, title: `Ticket ${id}`, ask: `Ask ${id}`, recommendation: null, why: [], options: [], next: 'Then.', evidence: [], details: null, openSince: '2026-01-01T00:00:00Z' }, detailsHtml: null, waiting: '1 h' }) as never
const groups = [{ checkpoint: 'Approve plan', items: [item(1), item(2)] }, { checkpoint: 'Review', items: [item(3, 'Review')] }] as never

describe('selection from ?t=', () => {
  it('selects a known row and shows its detail below 960px', () => {
    const r = resolveSelection(groups, 2)
    expect(r).toMatchObject({ detail: true, stale: false })
    expect(r.selected!.id).toBe(2)
  })
  it('an unknown or decided t is stale and selects the first row', () => {
    const r = resolveSelection(groups, 99)
    expect(r).toMatchObject({ detail: false, stale: true })
    expect(r.selected!.id).toBe(1)
  })
  it('without t the first row is selected, the list alone below 960px', () => {
    expect(resolveSelection(groups)).toMatchObject({ detail: false, stale: false, selected: { id: 1 } })
    expect(resolveSelection([], 5)).toMatchObject({ selected: null, stale: true })
  })
  it('the next row after a decision is the following one, else the previous, else none', () => {
    expect(nextRow(groups, 2)).toBe(3)
    expect(nextRow(groups, 3)).toBe(2)
    expect(nextRow([{ checkpoint: 'Review', items: [item(3)] }] as never, 3)).toBeUndefined()
  })
})

describe('links', () => {
  it('keeps the filters beside t', () => {
    expect(inboxHref({}, undefined)).toBe('/inbox')
    expect(inboxHref({ product: 2, checkpoint: 'Review' }, 7)).toBe('/inbox?product=2&checkpoint=Review&t=7')
  })
  it('redirects #t<id> to ?t= and keeps the filters', () => {
    expect(redirectHref('#t42', '')).toBe('/inbox?t=42')
    expect(redirectHref('#t42', '?product=2')).toBe('/inbox?product=2&t=42')
    expect(redirectHref('#details', '')).toBeNull()
    expect(redirectHref('', '')).toBeNull()
  })
})

describe('empty copy', () => {
  it('says what the role needs', () => {
    expect(emptyCopy({ owner: false, working: 3 })).toEqual({ text: 'Nothing needs you. The factory is working on 3 tickets.', action: { href: '/', label: 'Open the Workflow' } })
    expect(emptyCopy({ owner: false, working: 1 }).text).toBe('Nothing needs you. The factory is working on 1 ticket.')
    expect(emptyCopy({ owner: true, working: 3 })).toEqual({ text: 'Nothing waits for you.', action: { href: '/requests', label: 'Open Requests' } })
  })
  it('filtered-empty and load-error', () => {
    expect(emptyCopy({ owner: false, working: 0, picked: 'Review' })).toEqual({ text: 'Nothing waits for you at Review.', action: { href: '/inbox', label: 'Show all decisions' } })
    expect(emptyCopy({ owner: true, working: 0, error: true }).text).toBe('Could not load the Inbox. Try again.')
  })
})

describe('inbox view', () => {
  const view = async (selected: number, detail: boolean) => {
    const { InboxView } = await import('../src/app/(app)/components/InboxView')
    return renderToStaticMarkup(createElement(InboxView, { groups, selected, detail, admin: true, filters: {}, workflowHref: {} }))
  }
  it('lists every row as a link and marks the selected one', async () => {
    const html = await view(2, true)
    expect(html.match(/data-testid="inbox-row"/g)).toHaveLength(3)
    expect(html).toContain('href="/inbox?t=2"')
    expect(html.match(/aria-current="true"/g)).toHaveLength(1)
  })
  it('shows the card of the selection with a back link, the list hidden below 960px only in detail', async () => {
    const detail = await view(2, true)
    expect(detail).toContain('Ask 2')
    expect(detail).not.toContain('Ask 3</h2>')
    expect(detail).toContain('>Inbox</a>')
    expect(detail).toMatch(/<nav aria-label="Decisions" class="min-w-0 group-data-\[wide=false\]\/split:hidden"/)
    expect(await view(1, false)).toMatch(/<nav aria-label="Decisions" class="min-w-0 "/)
  })
  it('long text cannot widen the page', async () => {
    const html = await view(1, true)
    expect(html).toContain('[overflow-wrap:anywhere]')
    expect(html).toContain('truncate')
  })
})
