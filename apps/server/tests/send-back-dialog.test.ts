import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/app/(app)/lib/actions', () => ({ sendBackAction: async () => ({}) }))

import { SendBackDialog } from '../src/app/(app)/components/SendBackDialog'
import { SEND_BACK, sendBackOptions } from '../src/lib/send-back-options'

describe('sendBackOptions', () => {
  it('lists only the outcomes of the existing actions', () => {
    expect(sendBackOptions('Needs you')).toEqual([SEND_BACK.backToBuild])
    expect(sendBackOptions('Cancelled')).toEqual([SEND_BACK.backToBacklog])
    expect(sendBackOptions('Accept on staging', 'release')).toEqual([SEND_BACK.requestChanges])
  })
  it('lists nothing for any other need', () => {
    expect(sendBackOptions('Approve plan', 'plan')).toEqual([])
    expect(sendBackOptions(null)).toEqual([])
  })
  it('asks for a note only where the staging action needs one', () => {
    expect(Object.values(SEND_BACK).filter((o) => o.noteRequired).map((o) => o.value)).toEqual(['requestChanges'])
  })
})

describe('SendBackDialog', () => {
  it('renders one trigger and no native dialog', () => {
    const html = renderToStaticMarkup(createElement(SendBackDialog, { ticket: 7, options: [SEND_BACK.backToBuild] }))
    expect(html).toContain('Send back…')
    expect(html).not.toContain('confirm(')
  })
})
