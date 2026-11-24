import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { HoldStrip } from '../src/app/(app)/components/factory/HoldStrip'

vi.mock('../src/app/(app)/components/TicketRef', () => ({
  TicketRef: ({ recordId, number }: { recordId: number; number: number }) =>
    createElement('a', { href: `/tickets/${recordId}` }, `#${number}`),
}))

describe('HoldStrip', () => {
  it('renders nothing without holds', () => {
    expect(renderToStaticMarkup(createElement(HoldStrip, { holds: [] }))).toBe('')
  })

  it('names the missing role, the queued runs by stage and links to Connect', () => {
    const html = renderToStaticMarkup(
      createElement(HoldStrip, {
        holds: [
          {
            kind: 'no-agent-connected',
            role: 'builder',
            queued: 2,
            byStage: [{ stage: 'build', queued: 2 }],
          },
        ],
      }),
    )
    expect(html).toContain('No builder session is connected: 2 runs wait (Build 2).')
    expect(html).toMatch(/<a [^>]*href="\/settings\/api-key"[^>]*>Connect a session<\/a>/)
  })

  it('names the idle Runner in text', () => {
    const html = renderToStaticMarkup(createElement(HoldStrip, { holds: [{ kind: 'runner-idle', queued: 1 }] }))
    expect(html).toContain('The Runner has not picked up a run for 10 minutes: 1 run waits.')
  })
})
