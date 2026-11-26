import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RetroOutcome, type OutcomeActions } from '../../src/app/(app)/components/retro/RetroOutcome'
import type { Decision, Outcome } from '../../src/core/retro/schema'

const change = (id: string, decision: Decision) => ({
  id,
  title: `Change ${id}`,
  section: 'Brief' as const,
  remove: null,
  add: `- Line ${id}`,
  decision,
})

type Scope = 'product' | 'factory'

const outcome = (decisions: Decision[], ticket: Decision = 'keep', scope: Scope = 'product'): Outcome => ({
  documents: [
    { scope, base: '## Brief\n- Old.\n', changes: decisions.map((decision, index) => change(`c${index}`, decision)) },
  ],
  tickets: [{ id: 't', title: 'A ticket', body: 'Why.', repo: 'factory', decision: ticket, number: null }],
  saved: [],
})

const stub = (update: Partial<OutcomeActions> = {}): OutcomeActions => ({
  decideChange: vi.fn(async () => ({})),
  editChange: vi.fn(async () => ({})),
  decideTicket: vi.fn(async () => ({})),
  apply: vi.fn(async () => ({})),
  ...update,
})

const show = (initial: Outcome, actions = stub(), isAdmin = true) =>
  render(
    createElement(RetroOutcome, {
      initial,
      applied: false,
      isAdmin,
      repos: { product: 'acme/app', factory: 'acme/factory' },
      day: '24 Nov',
      actions,
    }),
  )

const apply = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Apply' })

afterEach(cleanup)

describe('RetroOutcome', () => {
  it('keeps Apply disabled while a change is undecided and says how many are left', () => {
    show(outcome(['keep', 'undecided']))
    expect(apply().disabled).toBe(true)
    expect(screen.getByRole('status').textContent).toContain('1 left to review')
  })

  it('enables Apply once every change is decided', () => {
    show(outcome(['keep', 'discard']))
    expect(apply().disabled).toBe(false)
  })

  it('treats a change being edited as undecided until it is saved, and saves the edited text', async () => {
    const actions = stub()
    show(outcome(['keep']), actions)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(apply().disabled).toBe(true)
    expect(screen.getByRole('status').textContent).toContain('you are editing is not decided yet')
    fireEvent.change(screen.getByLabelText('Edit the new line'), { target: { value: '- My own words' } })
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(apply().disabled).toBe(false))
    expect(actions.editChange).toHaveBeenCalledWith('c0', '- My own words')
  })

  it('sends a Keep or Discard press to the server and shows the answer', async () => {
    const actions = stub({ decideChange: vi.fn(async () => ({ outcome: outcome(['discard']) })) })
    show(outcome(['undecided']), actions)
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(apply().disabled).toBe(false))
    expect(actions.decideChange).toHaveBeenCalledWith('c0', 'discard')
  })

  it('says only an Admin applies a kept Factory change', () => {
    show(outcome(['keep'], 'keep', 'factory'), stub(), false)
    expect(apply().disabled).toBe(true)
    expect(screen.getByRole('status').textContent).toContain('Only an Admin')
  })

  it('names the repository a ticket opens in and shows an error from Apply', async () => {
    const actions = stub({ apply: vi.fn(async () => ({ error: 'The forge is down.' })) })
    show(outcome(['keep']), actions)
    expect(screen.getByText('acme/factory')).toBeTruthy()
    fireEvent.click(apply())
    expect((await screen.findByRole('alert')).textContent).toBe('The forge is down.')
    expect(apply().disabled).toBe(false)
  })
})
