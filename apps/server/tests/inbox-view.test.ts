import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { actionBar, announcement, emptyPane, removeRow, restoreRow, selectionChanged, settleRow, syncRows, emptyCopy, inboxHref, nextRow, redirectHref, resolveSelection } from '../src/app/(app)/lib/inbox-view'
import { buildDecision } from '../src/lib/decision'
import { NEEDS } from '../src/lib/needs-you'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {}, replace() {}, refresh() {} }), useSearchParams: () => new URLSearchParams() }))
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

describe('the pane action bar', () => {
  const facts = { ticket: { id: 7, number: 7, title: 'A change', reviewRounds: 2, openCriticalDecisions: 2 }, product: { id: 1, name: 'web' }, human: { title: 'Pick', outcomes: ['yes', 'no'] }, skill: { name: 's', score: 1, baseline: 0, pr: 3 }, now: '2026-11-10T10:00:00.000Z' }
  it.each(NEEDS)('%s: at most one primary, and no Answer link without an open question', (need) => {
    const options = buildDecision(need, facts).options
    const bar = actionBar(options, 0, 7, need)
    expect(bar.answer).toEqual(need === 'Answer questions' ? { label: 'Answer questions', href: '/tickets/7?view=conversation' } : null)
    expect(bar.primary ? 1 : 0).toBeLessThanOrEqual(1)
    expect(bar.secondary).not.toContain(bar.primary)
    expect(bar.secondary.every((o) => !o.href?.includes('?view=conversation'))).toBe(true)
  })
  it('a card without a primary has none', () => {
    const options = buildDecision('Answer questions', facts).options
    expect(actionBar(options, 0, 7, 'Answer questions')).toMatchObject({ primary: null, secondary: [], answer: { label: 'Answer questions' } })
  })
  it('Answer N questions shows only while questions are open', () => {
    const options = buildDecision('Answer decisions', facts).options
    expect(actionBar(options, 2, 7).answer).toEqual({ label: 'Answer 2 questions', href: '/tickets/7?view=conversation' })
    expect(actionBar(options, 1, 7).answer?.label).toBe('Answer 1 question')
    expect(actionBar(options, 0, 7, 'Answer decisions').answer).toBeNull()
  })
  it('keeps the destructive and note options as secondaries for the dialog', () => {
    const bar = actionBar(buildDecision('Needs you', { ...facts, ticket: { ...facts.ticket, reviewRounds: 0 } }).options, 0, 7)
    expect(bar.primary).toBeTruthy()
    const cap = actionBar(buildDecision('Round cap reached', facts).options, 0, 7)
    expect(cap.primary?.label).toBe('Give one more round')
    expect(cap.secondary.map((o) => [o.label, o.destructive, o.note])).toEqual([['Stop', true, 'optional']])
  })
  it('announces what happened and the next row', () => {
    const approve = { label: 'Approve plan', action: 'approvePlan', primary: true, effect: '' } as const
    expect(announcement(approve, 471, 455)).toBe('Plan approved for #471. Next: #455.')
    expect(announcement(approve, 471)).toBe('Plan approved for #471.')
  })
})

describe('pane transitions', () => {
  const row = (i: number) => (groups as unknown as { items: never[] }[]).flatMap((g) => g.items)[i]!
  it('removing a row selects the next one and keeps the decided id after the last row', () => {
    const a = removeRow(emptyPane, groups, 2)
    expect(a.state.gone).toEqual([2])
    expect((a.next as { id: number }).id).toBe(3)
    const last = removeRow(emptyPane, [{ checkpoint: 'Review', items: [item(3)] }] as never, 3)
    expect(last.next).toBeUndefined()
    expect(last.state.gone).toEqual([3])
  })
  it('restoring puts the row back with a snapshot and the error, and goes back only while the selection is where the removal moved it', () => {
    const removed = removeRow(emptyPane, groups, 2)
    const snapshot = row(1)
    const here = restoreRow(removed.state, snapshot, 'This decision changed.', 3, 3)
    expect(here.state.gone).toEqual([])
    expect(here.state.failed).toMatchObject({ error: 'This decision changed.', at: 3 })
    expect(here.goTo).toBe(2)
    expect(restoreRow(removed.state, snapshot, 'x', 1, 3).goTo).toBeUndefined()
  })
  it('the stale case: the server no longer lists the row, the snapshot still carries the failure', () => {
    const removed = removeRow(emptyPane, groups, 2)
    const stale = [{ checkpoint: 'Review', items: [item(3, 'Review')] }]
    const failed = restoreRow(removed.state, row(1), 'This decision changed.', 3, 3).state
    expect(stale.flatMap((g) => g.items).some((i) => (i as { id: number }).id === 2)).toBe(false)
    expect((failed.failed!.item as { id: number }).id).toBe(2)
  })
  it('a failure clears when the selection moves elsewhere, and the server list wins after a refresh', () => {
    const failed = restoreRow(emptyPane, row(0), 'x', 3, 3).state
    expect(selectionChanged(failed, 3).failed).not.toBeNull()
    expect(selectionChanged(failed, 1).failed).not.toBeNull()
    expect(selectionChanged(failed, 9).failed).toBeNull()
    const done = settleRow(removeRow(emptyPane, groups, 1).state, 1)
    expect(syncRows(done)).toEqual({ gone: [], settled: [], failed: null })
    expect(syncRows(removeRow(emptyPane, groups, 1).state).gone).toEqual([1])
  })
})
