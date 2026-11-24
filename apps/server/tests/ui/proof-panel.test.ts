import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { ProofPanel } from '../../src/app/(app)/components/ticket/ProofPanel'
import type { ProofGroup } from '../../src/core/views/ticket-parts'

const group: ProofGroup = {
  criterion: 'c1',
  proofs: [
    {
      id: 5,
      kind: 'screenshot',
      source: 'session',
      sha: 'h',
      body: null,
      url: null,
      attachment: { id: 7, caption: 'Progress bar filling' },
    },
  ],
}

afterEach(cleanup)

describe('ProofPanel', () => {
  it('shows nothing without a proof group', () => {
    const { container } = render(createElement(ProofPanel, { group: undefined, number: 1 }))
    expect(container.textContent).toBe('')
  })

  it('shows a screenshot proof as a picture and opens the gallery viewer on click', () => {
    render(createElement(ProofPanel, { group, number: 1 }))
    const picture = screen.getByRole('img', { name: 'Progress bar filling' })
    expect(picture.getAttribute('src')).toBe('/api/attachments/7')
    fireEvent.click(screen.getByRole('button', { name: 'Progress bar filling' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('1 of 1')).toBeTruthy()
    expect(within(dialog).getByRole('img', { name: 'Progress bar filling' })).toBeTruthy()
  })
})
