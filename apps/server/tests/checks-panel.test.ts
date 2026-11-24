import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChecksPanel } from '../src/app/(app)/components/ticket/ChecksPanel'
import type { CheckView } from '../src/core/views/ticket-parts'

const SINCE = '2026-11-23T14:03:00.000Z'
const MIN = 60_000
const pull = { url: 'https://github.com/acme/app/pull/784', label: 'Open pull request #784 on GitHub' }
const NOTICE = 'No checks have started on this pull request. GitHub does not start checks when the pull request'

const check = (name: string, status: string, conclusion: string | null, url = `https://ci/${name}`): CheckView => ({
  name, status, conclusion, url,
})

const html = (checks: CheckView[], minutes: number) =>
  renderToStaticMarkup(
    createElement(ChecksPanel, { checks, since: SINCE, now: +new Date(SINCE) + minutes * MIN, pull }),
  )

const FOUR = [
  check('lint', 'completed', 'success'),
  check('unit', 'in_progress', null),
  check('browser', 'completed', 'failure'),
  check('image', 'queued', null, ''),
]

describe('ChecksPanel', () => {
  it('lists every check by name with its state', () => {
    const out = html(FOUR, 12)
    expect(out).toMatch(/Passed<\/span><span>lint</)
    expect(out).toMatch(/Running<\/span><span>unit</)
    expect(out).toMatch(/Failed<\/span><span>browser</)
    expect(out).toMatch(/Waiting<\/span><span>image</)
  })

  it('links each started check to its log in a new tab and a check without url has no link', () => {
    const out = html([...FOUR, check('lone', 'completed', 'success', '')], 12)
    const logs = [...out.matchAll(/<a href="https:\/\/ci\/[^"]+"[^>]*>/g)].map((m) => m[0])
    expect(logs).toHaveLength(3)
    for (const tag of logs) expect(tag).toContain('target="_blank" rel="noopener noreferrer"')
    expect(out.match(/\(opens in new tab\)/g)).toHaveLength(3)
    expect(out).not.toContain('https://ci/image')
    expect(out).not.toContain('https://ci/lone')
  })

  it('says how long the ticket has waited with the exact time', () => {
    const out = html(FOUR, 12)
    expect(out).toContain('Waiting <span class="mono">12 min</span>')
    expect(out).toMatch(new RegExp(`<time datetime="${SINCE}" title="2026-11-23 14:03 UTC"`, 'i'))
  })

  it('shows the notice with the pull request link from 10 minutes without a check', () => {
    expect(html([], 9)).not.toContain(NOTICE)
    expect(html([], 9)).not.toContain(pull.label)
    expect(html([], 10)).toContain(NOTICE)
    expect(html([], 11)).toContain(NOTICE)
    expect(html([], 11)).toContain(pull.label)
    expect(html([check('lint', 'queued', null)], 11)).not.toContain(NOTICE)
    expect(html([check('lint', 'queued', null)], 11)).not.toContain(pull.label)
  })
})
