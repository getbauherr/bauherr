import { cleanup, render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BriefSheet } from '../../src/app/(app)/components/ticket/BriefSheet'
import { emptyRecord } from '../../src/core/record/schema'
import { criterion, source } from '../core/fixtures'

vi.mock('../../src/app/(app)/components/RefText', () => ({
  RefText: ({ text }: { text: string }) => text,
}))

afterEach(cleanup)

describe('BriefSheet', () => {
  it('puts the decision above Criteria, Plan and Risk, which start collapsed', () => {
    const record = {
      ...emptyRecord(source, 'change'),
      goal: 'Show progress',
      criteria: [criterion(1)],
      plan: { steps: ['Stream it.'] },
    }
    const decisions = createElement('p', { 'data-testid': 'decision' }, 'Pick one')
    const { container, getByTestId } = render(
      createElement(BriefSheet, { record, mockups: [], missing: false, decisions }),
    )
    const folds = Array.from(container.querySelectorAll('details'))
    expect(folds.map((fold) => fold.querySelector('summary')?.textContent)).toEqual([
      'Acceptance criteria',
      'Plan',
      'Risk',
    ])
    expect(folds.every((fold) => !fold.open)).toBe(true)
    expect(getByTestId('decision').compareDocumentPosition(folds[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
