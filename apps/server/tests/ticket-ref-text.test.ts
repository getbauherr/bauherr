import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RefTextView } from '../src/app/(app)/components/RefTextView'
import type { TicketRefs } from '../src/core/views/refs'

const ticket = { recordId: 41, number: 555, title: 'Run page: redesign', stage: 'build' as const }
const refs = (title = ticket.title): TicketRefs => {
  const ref = { ...ticket, title }
  return { byId: new Map([[41, ref]]), byMention: new Map([['acme/app#555', ref]]) }
}
const render = (text: string, found = refs()) =>
  renderToStaticMarkup(createElement(RefTextView, { text, repo: 'acme/app', refs: found }))

describe('RefTextView', () => {
  it('turns a known number into a link with the title to the ticket', () => {
    const html = render('see #555 first')
    expect(html).toMatch(/<a [^>]*href="\/tickets\/41"[^>]*>#555 Run page: redesign<\/a>/)
    expect(html).toContain('see ')
    expect(html).toContain(' first')
  })

  it('cuts titles over 60 characters with an ellipsis', () => {
    const title = 'x'.repeat(61)
    expect(render('#555', refs(title))).toContain(`>#555 ${'x'.repeat(60)}…</a>`)
    expect(render('#555', refs('y'.repeat(60)))).toContain(`>#555 ${'y'.repeat(60)}</a>`)
  })

  it('keeps an unknown number as plain text', () => {
    const html = render('#9999 and #555')
    expect(html).toContain('#9999 and ')
    expect(html).not.toContain('/tickets/9999')
    expect(html).toContain('#555 Run page: redesign')
  })

  it('ignores a hash inside a word or path', () => {
    expect(render('C#555 or /a/#555')).not.toContain('<a ')
  })
})
