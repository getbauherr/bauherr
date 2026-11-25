import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { RequestRows } from '../../src/app/(app)/components/request/RequestRows'
import { listRequests } from '../../src/core/views/request-status'
import type { TicketRow } from '../../src/core/views/rows'

afterEach(cleanup)

const ticket = (recordId: number, title: string, reporter: string) =>
  ({
    recordId,
    number: recordId,
    title,
    type: 'bug',
    reporter,
    stage: 'build',
    waitingOn: 'agents',
    run: null,
    card: null,
    parked: null,
    ended: null,
    closedAs: null,
    questionDrafted: false,
    createdAt: new Date(),
    changedAt: new Date(),
  }) as TicketRow

const rows = [ticket(7, 'Mine', 'Jo'), ticket(8, 'Theirs', 'al')]

const show = (staff: boolean) => {
  render(createElement(RequestRows, { list: listRequests(rows, { forgeLogins: ['jo'], sentRecordIds: [] }), staff }))
  return (title: string) => screen.getByRole('link', { name: title }).getAttribute('href')
}

describe('the rows of the Requests page', () => {
  it('link a product owner to the request page', () => {
    expect(show(false)('Mine')).toBe('/requests/7')
  })

  it('link staff to the Ticket page', () => {
    expect(show(true)('Theirs')).toBe('/tickets/8')
  })

  it('say You only for a request of the viewer', () => {
    show(false)
    expect(screen.getByText('Bug · You')).toBeTruthy()
    expect(screen.getByText('Bug · al')).toBeTruthy()
  })
})
