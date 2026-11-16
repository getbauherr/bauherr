import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CiPanel } from '../src/app/(app)/components/CiPanel'

const ago = (s: number) => new Date(Date.now() - s * 1000).toISOString()
const summary = (updatedAt: string) => ({ total: 3, passed: 1, pending: 1, failed: ['lint'], url: null, updatedAt, rows: [
  { name: 'test', status: 'in_progress', conclusion: null, startedAt: ago(180) },
  { name: 'lint', status: 'completed', conclusion: 'failure', startedAt: ago(600) },
  { name: 'build', status: 'completed', conclusion: 'success' },
] })

describe('CI card', () => {
  const html = renderToStaticMarkup(createElement(CiPanel, { summary: summary(ago(40)) }))
  it('shows the state of each check and how long a running one runs', () => {
    expect(html).toContain('Passed')
    expect(html).toContain('running for 3 min')
    expect(html.match(/data-testid="ci-row"/g)).toHaveLength(3)
  })
  it('names a failing check with the word Failed, not colour only', () => expect(html).toMatch(/× Failed<\/span><span class="text-destructive">lint/))
  it('reads Checked N s ago within 60 s, with the exact time in title', () => {
    expect(html).toContain('Checked 40 s ago')
    expect(html).toMatch(/title="\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC"/)
  })
  it('falls back to minutes after 60 s', () => expect(renderToStaticMarkup(createElement(CiPanel, { summary: summary(ago(300)) }))).toContain('Checked 5 min ago'))
})
