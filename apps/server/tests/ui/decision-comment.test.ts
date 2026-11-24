import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DecisionForm, type DecisionAction } from '../../src/app/(app)/components/ticket/DecisionForm'

vi.mock('../../src/app/(app)/(shell)/tickets/actions', () => ({
  decideTicket: vi.fn(() => Promise.resolve({})),
}))

afterEach(cleanup)

const actions: DecisionAction[] = [{ choice: 'approve', label: 'Accept', variant: 'default' }]

const form = () =>
  render(
    createElement(DecisionForm, {
      recordId: 7,
      ask: 'result:1',
      seq: 1,
      actions,
      children: createElement('p', null, 'The card body'),
    }),
  )

describe('the comment area of a ticket card', () => {
  it('is the shared assistant-ui composer with the attachment button and the drop zone', () => {
    form()
    fireEvent.click(screen.getByRole('button', { name: 'Add a comment' }))
    const input = screen.getByLabelText('Comment')
    expect(input.tagName).toBe('TEXTAREA')
    expect(screen.getByRole('button', { name: 'Add attachment' })).toBeTruthy()
    expect(input.closest('[data-dragging]')).toBeNull()
    fireEvent.dragEnter(input, { dataTransfer: { types: ['Files'], dropEffect: 'none' } })
    expect(input.closest('[data-dragging="true"]')).toBeTruthy()
  })

  it('keeps what is typed in the shared composer when the comment is revealed', () => {
    form()
    fireEvent.click(screen.getByRole('button', { name: 'Add a comment' }))
    fireEvent.change(screen.getByLabelText('Comment'), { target: { value: 'Redo the mockup.' } })
    expect(screen.getByLabelText<HTMLTextAreaElement>('Comment').value).toBe('Redo the mockup.')
    expect(screen.getByRole('button', { name: 'Accept' })).toBeTruthy()
  })
})
