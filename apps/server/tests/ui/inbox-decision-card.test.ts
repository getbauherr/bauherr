import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DecisionCard } from '../../src/app/(app)/components/inbox/DecisionCard'
import type { Pending, Staged } from '../../src/app/(app)/components/inbox/use-pending-decisions'
import { decisionOf } from '../../src/app/(app)/lib/inbox-decision'
import type { ThreadSource } from '../../src/app/(app)/lib/inbox-thread'
import type { StoredCard } from '../../src/core/record/store'
import { emptyRecord } from '../../src/core/record/schema'
import { cardOf, need, criterion, source, sourceOf } from '../helpers/ticket-source'

afterEach(cleanup)

const pendingOf = (staged: Record<string, Staged> = {}): Pending => ({
  staged,
  stage: vi.fn(),
  undo: vi.fn(),
  flush: vi.fn(),
})

const show = (card: StoredCard, pending = pendingOf(), extra: Partial<ThreadSource> = {}) => {
  const model = need(decisionOf(sourceOf(card, extra)))
  render(createElement(DecisionCard, { model, pending }))
  return { model, pending }
}

const brief = cardOf('brief', 'one-way-door', [], 2)

describe('decision card', () => {
  it('stages the one primary action with its receipt', () => {
    const { pending } = show(brief)
    expect(screen.getByText('Recommended: Approve Brief')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Approve Brief' }))
    expect(vi.mocked(pending.stage).mock.calls[0]?.[0]).toMatchObject({
      receipt: 'Brief approved',
      input: { recordId: 126, ask: 'brief', seq: 2, choice: 'approve' },
    })
  })

  it('expands the note inline for changes and needs text before it stages', () => {
    const { pending } = show(brief)
    fireEvent.click(screen.getByRole('button', { name: 'Request changes' }))
    const confirm = screen.getByRole('button', { name: 'Request changes' })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Drop c3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Request changes' }))
    expect(vi.mocked(pending.stage).mock.calls[0]?.[0]).toMatchObject({
      input: { choice: 'request-changes', note: 'Drop c3' },
    })
  })

  it('sends the recommended criteria of the picker and lets the owner change them', () => {
    const record = {
      ...emptyRecord(source, 'change'),
      criteria: [criterion('c1', 'met'), criterion('c2', 'missing'), criterion('c3', 'missing')],
    }
    const card = cardOf('question', 'verify-rounds', ['drop-criteria', 'accept-anyway'], 4)
    const { pending } = show(card, pendingOf(), { record })
    fireEvent.click(screen.getByRole('checkbox', { name: /c3/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Drop criterion c2' }))
    expect(vi.mocked(pending.stage).mock.calls[0]?.[0]).toMatchObject({
      receipt: 'Dropped c2',
      input: { choice: 'drop-criteria', criteria: ['c2'] },
    })
  })

  it('collapses to the receipt with Undo once decided', () => {
    const staged: Record<string, Staged> = {
      '126:brief:2': { key: '126:brief:2', recordId: 126, number: 928, receipt: 'Brief approved', input: {} },
    }
    const { pending } = show(brief, pendingOf(staged))
    expect(screen.getByText('Brief approved')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(pending.undo).toHaveBeenCalledWith('126:brief:2')
  })
})
