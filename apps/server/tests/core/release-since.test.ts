import { describe, expect, it } from 'vitest'
import { editItem, readNotes, UNRELEASED, writeNotesFor } from '../../src/core/releases/notes-store'
import { releasePanel } from '../../src/core/releases/panel'
import { releaseHarness } from './release-harness'

const { f, h, recording, mergeTicket, refresh, setup, releaser, at, start, advance, deployed, ask, NOW } =
  releaseHarness('core_release_since')

describe('release since the last real release', () => {
  it('counts everything since the last real release and ignores release candidates', async () => {
    const s = await setup()
    const fake = f.fake()
    const candidate = fake.commit(s.repo, 'main', 'rc.txt', 'rc')
    fake.setCommitDate(s.repo, candidate, '2026-11-23T10:00:00Z')
    fake.addRelease(s.repo, { tag: 'v0.7.0-rc.1', sha: candidate, createdAt: '2026-11-23T10:00:00Z' })
    await mergeTicket(s.repo, 'Plans as pictures', 3, 'visible', false, '2026-11-24T09:00:00Z')
    await refresh()
    const panel = await releasePanel(h.payload(), at(), NOW)
    expect(panel?.since).toBe('v0.6.0')
    expect(panel?.changes).toBe(3)
    expect(panel?.proposal.version).toBe('v0.7.0')
    const run = await start(releaser())
    expect(run.tickets).toHaveLength(3)
    expect(run.body).toContain('Plans as pictures')
    expect(run.body).toContain('Memory as documents')
  })

  it('writes the notes at the press for every change since the last release and keeps owner edits', async () => {
    const s = await setup()
    const r = releaser()
    const where = { ...at(), version: UNRELEASED }
    const before = (await r.ready(at()))?.merged ?? []
    await writeNotesFor(h.payload(), where, before, ask)
    const first = (await readNotes(h.payload(), h.ids.product, UNRELEASED))?.items.find((item) => item.kind === 'new')
    const edit = { title: 'Owner wording', text: 'The owner wrote this.', area: 'Memory' }
    await editItem(h.payload(), where, first?.id ?? '', edit)
    await mergeTicket(s.repo, 'Plans as pictures', 3, 'visible', false, '2026-11-24T09:00:00Z')
    await refresh()
    const run = await start(r)
    expect(run.body).toContain('The owner wrote this.')
    expect(run.body).toContain('Plans as pictures')
  })

  it('proposes an unused version after a fixed version is chosen and refuses the used one', async () => {
    const s = await setup()
    const r = releaser()
    const first = await start(r)
    deployed(s, 'failure')
    await advance(r, first.id)
    await r.answer(at(), first.id, 'release-fixed-later')
    const panel = await releasePanel(h.payload(), at(), NOW)
    expect(panel?.refusal).toBeNull()
    expect(panel?.proposal.version).toBe('v0.7.1')
    await expect(start(r, 'v0.7.0')).rejects.toThrow(/already used/)
    expect((await start(r, 'v0.7.1')).version).toBe('v0.7.1')
  })

  it('reads the release page from stored state without calling the forge', async () => {
    await setup()
    const { backend, seen } = recording(f.fake())
    await releaser(backend).ready(at())
    await releasePanel(h.payload(), at(), NOW)
    expect([...seen.methods]).toEqual([])
  })
})
