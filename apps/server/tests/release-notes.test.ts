import { expect, it } from 'vitest'
import { collectItem, nextVersion, renderNotes, rewrite } from '../src/lib/release-notes'
import { buildStagingSummary } from '../src/lib/summary'

const summary = (plan: string) => buildStagingSummary({ ticket: { number: 7, title: 't', url: 'https://x/7' }, plan, worklog: null, mrs: [{ number: 3, url: 'https://x/pull/3', title: 'Export', body: '' }], evidence: null, stagingUrl: null, mergeSha: null })
const feature = collectItem({ number: 7, title: 'feat: CSV export', url: 'https://x/7', labels: [] }, summary('## Goal\n- Download invoices as CSV'))
const fix = collectItem({ number: 8, title: 'Totals wrong', url: 'https://x/8', labels: ['bug'] }, null)

it('groups Features and Fixes with Ticket and MR links', () => {
  expect(feature).toMatchObject({ number: 7, title: 'CSV export', fix: false, bullets: ['Download invoices as CSV'], mrs: ['[#3 Export](https://x/pull/3)'] })
  expect(renderNotes([feature, fix])).toBe(
    '### Features\n- CSV export ([#7](https://x/7), [#3 Export](https://x/pull/3))\n  - Download invoices as CSV\n\n### Fixes\n- Totals wrong ([#8](https://x/8))',
  )
})

it('renders an empty batch as empty text and omits empty groups', () => {
  expect(renderNotes([])).toBe('')
  expect(renderNotes([fix])).not.toContain('Features')
})

it('computes the next semver from conventional commits', () => {
  expect(nextVersion(null, ['feat: a'])).toBe('0.1.0')
  expect(nextVersion('v1.2.3', ['fix: a', 'chore: b'])).toBe('1.2.4')
  expect(nextVersion('v1.2.3', ['fix: a', 'feat(ui): b'])).toBe('1.3.0')
  expect(nextVersion('1.2.3', ['feat!: drop api', 'feat: b'])).toBe('2.0.0')
  expect(nextVersion('v1.2.3', ['fix: a\n\nBREAKING CHANGE: gone'])).toBe('2.0.0')
})

it('keeps the rewrite only when every link survived', async () => {
  const notes = '- A ([#7](https://x/7))'
  expect(await rewrite(notes, async () => '- Easier A ([#7](https://x/7))')).toBe('- Easier A ([#7](https://x/7))')
  expect(await rewrite(notes, async () => '- Easier A')).toBe(notes)
  expect(await rewrite(notes, async () => '')).toBe(notes)
  expect(await rewrite(notes, async () => Promise.reject(new Error('budget')))).toBe(notes)
})
