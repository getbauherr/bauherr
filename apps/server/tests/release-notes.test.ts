import { expect, it } from 'vitest'
import { changelogView, replaceVersion, stripBullets } from '../src/lib/changelog'
import { areaOf } from '../src/lib/feature-map'
import { collectItem, nextVersion, renderNotes, rewrite, summarizeRelease, words } from '../src/lib/release-notes'
import { buildStagingSummary } from '../src/lib/summary'

const summary = (plan: string) => buildStagingSummary({ ticket: { number: 7, title: 't', url: 'https://x/7' }, plan, worklog: null, mrs: [{ number: 3, url: 'https://x/pull/3', title: 'Export', body: '' }], evidence: null, stagingUrl: null, mergeSha: null })
const item = (title: string, o: Partial<ReturnType<typeof collectItem>> = {}, labels: string[] = []) => ({ ...collectItem({ number: 1, title, url: 'https://x/1', labels }, null), ...o })

it('one line per Ticket from the first "what you get" bullet, else the title', () => {
  const feature = collectItem({ number: 7, title: 'feat: CSV export', url: 'https://x/7', labels: [] }, summary('## Goal\n- Download invoices as CSV\n- Second outcome'))
  expect(feature).toMatchObject({ number: 7, title: 'CSV export', line: 'Download invoices as CSV', type: 'feat', breaking: false })
  expect(item('fix: Totals wrong').line).toBe('Totals wrong')
})

it('cuts a line at 15 words and drops link targets', () => {
  const long = Array.from({ length: 20 }, (_, i) => `w${i}`).join(' ')
  expect(words(long).split(' ')).toHaveLength(15)
  expect(words(long)).toMatch(/w14…$/)
  expect(words('see [the docs](https://x) now')).toBe('see the docs now')
  expect(words('short line')).toBe('short line')
})

it('groups by area, biggest first, Other last', () => {
  const notes = renderNotes([item('feat: A', { number: 1, area: 'Releases' }), item('feat: B', { number: 2, area: 'Requests' }), item('feat: C', { number: 3, area: 'Requests' }), item('feat: D', { number: 4, area: null })])
  expect(notes).toBe(
    '### Requests\n- B ([#2](https://x/1))\n- C ([#3](https://x/1))\n\n### Releases\n- A ([#1](https://x/1))\n\n### Other\n- D ([#4](https://x/1))',
  )
})

it('groups under "Changes" when the Product has no feature map', () => {
  expect(renderNotes([item('feat: A')])).toBe('### Changes\n- A ([#1](https://x/1))')
})

it('collapses internal types into one line and keeps docs with an area', () => {
  const notes = renderNotes([item('ci: Faster', { number: 2 }), item('refactor: Split', { number: 3 }), item('docs: Guide', { number: 4, area: null }), item('docs: Releasing', { number: 5, area: 'Releases' }), item('feat: A', { number: 1, area: 'Releases' })])
  expect(notes).toBe('### Releases\n- Releasing ([#5](https://x/1))\n- A ([#1](https://x/1))\n\nInternal: 3 changes ([#2](https://x/1), [#3](https://x/1), [#4](https://x/1))')
  expect(renderNotes([item('chore: x')])).toBe('Internal: 1 change ([#1](https://x/1))')
})

it('pins breaking entries on top as Changed behaviour, from "!" or the breaking label', () => {
  const notes = renderNotes([item('feat: A', { number: 1, area: 'Releases' }), item('feat!: Gate on', { number: 2, area: 'Releases' }), item('fix: Flag', { number: 3, area: 'Releases' }, ['breaking']), item('chore!: Drop node 20', { number: 4 })])
  expect(notes.startsWith('### Changed behaviour\n- Gate on ([#2]')).toBe(true)
  expect(notes).toContain('- Flag ([#3]')
  expect(notes).toContain('- Drop node 20 ([#4]')
  expect(notes).toMatch(/### Releases\n- A \(\[#1\]/)
  expect(notes).not.toContain('Internal')
})

it('renders an empty batch as empty text', () => {
  expect(renderNotes([])).toBe('')
})

it('picks the area of the feature whose source holds most of the changed paths', () => {
  const f = (area: string, ...source: string[]) => ({ id: area, area, source }) as never
  const map = [f('Releases', 'apps/server/src/lib/release.ts', 'apps/server/src/lib/release/'), f('Requests', 'apps/server/src/lib/intake/**')]
  expect(areaOf(map, ['apps/server/src/lib/release.ts', 'apps/server/src/lib/release/a.ts', 'apps/server/src/lib/intake/b.ts'])).toBe('Releases')
  expect(areaOf(map, ['apps/server/src/lib/intake/b.ts'])).toBe('Requests')
  expect(areaOf(map, ['README.md'])).toBeNull()
  expect(areaOf(map, [])).toBeNull()
})

it('shapes the in-app view: area filter, pinned stays, internal collapses', () => {
  const md = '# Changelog\n\n## Unreleased\n\n## 1.0.0 - 2026-01-01\n\n### Changed behaviour\n- P ([#9](u))\n\n### Releases\n- A ([#1](u))\n\n### Requests\n- B ([#2](u))\n\nInternal: 2 changes ([#3](u), [#4](u))\n'
  const all = changelogView(md)
  expect(all.areas).toEqual(['Releases', 'Requests'])
  expect(all.versions).toHaveLength(1)
  expect(all.versions[0]!.internal).toEqual({ summary: 'Internal: 2 changes', links: '- [#3](u)\n- [#4](u)' })
  const only = changelogView(md, 'Requests').versions[0]!
  expect(only.md).toContain('### Requests')
  expect(only.md).toContain('### Changed behaviour')
  expect(only.md).not.toContain('### Releases')
  expect(only.internal).toBeNull()
})

it('strips bullet floods and replaces one version body keeping heading and lead', () => {
  const old = '## 0.1.1 - 2026-11-09\n\nPromoted.\n\n### Features\n- A ([#1](i), [#2 t](https://g/pull/2))\n  - detail\n  - more\n\n## 0.1.0 - 2026-11-08\n\n### Features\n- B\n'
  expect(stripBullets(old)).toBe('## 0.1.1 - 2026-11-09\n\nPromoted.\n\n### Features\n- A ([#1](i))\n\n## 0.1.0 - 2026-11-08\n\n### Features\n- B\n')
  expect(replaceVersion(old, 'v0.1.1', '### Releases\n- A')).toBe('## 0.1.1 - 2026-11-09\n\nPromoted.\n\n### Releases\n- A\n\n## 0.1.0 - 2026-11-08\n\n### Features\n- B\n')
})

it('computes the next semver from conventional commits', () => {
  expect(nextVersion(null, ['feat: a'])).toBe('0.1.0')
  expect(nextVersion('v1.2.3', ['fix: a', 'chore: b'])).toBe('1.2.4')
  expect(nextVersion('v1.2.3', ['fix: a', 'feat(ui): b'])).toBe('1.3.0')
  expect(nextVersion('1.2.3', ['feat!: drop api', 'feat: b'])).toBe('2.0.0')
  expect(nextVersion('v1.2.3', ['fix: a\n\nBREAKING CHANGE: gone'])).toBe('2.0.0')
})

it('numbers pre-releases from the existing rc tags of the next stable version', () => {
  expect(nextVersion(null, ['feat: a'], [])).toBe('0.1.0-rc.1')
  expect(nextVersion(null, ['feat: a'], ['v0.1.0-rc.1'])).toBe('0.1.0-rc.2')
  expect(nextVersion(null, ['fix: a'], ['v0.1.0-rc.2', 'v0.1.0-rc.10', 'v0.2.0-rc.4', 'v0.1.0-rc.x'])).toBe('0.1.0-rc.11')
  expect(nextVersion('v0.1.0', ['feat: a'], ['v0.1.0', 'v0.1.0-rc.3'])).toBe('0.2.0-rc.1')
})

it('keeps the rewrite only when every link survived', async () => {
  const notes = '- A ([#7](https://x/7))'
  expect(await rewrite(notes, async () => '- Easier A ([#7](https://x/7))')).toBe('- Easier A ([#7](https://x/7))')
  expect(await rewrite(notes, async () => '- Easier A')).toBe(notes)
  expect(await rewrite(notes, async () => '')).toBe(notes)
  expect(await rewrite(notes, async () => Promise.reject(new Error('budget')))).toBe(notes)
})

it('summarizes the notes and never blocks on a model error or empty answer', async () => {
  expect(await summarizeRelease('- A', async () => '  Easier A.\n')).toBe('Easier A.')
  expect(await summarizeRelease('- A', async () => { throw new Error('down') })).toBe('')
  expect(await summarizeRelease('- A', async () => '  ')).toBe('')
})
