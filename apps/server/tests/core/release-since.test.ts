import { describe, expect, it } from 'vitest'
import { editItem, readNotes, UNRELEASED, writeNotesFor } from '../../src/core/releases/notes-store'
import { releasePanel } from '../../src/core/releases/panel'
import { releasesPage } from '../../src/core/releases/view'
import { releaseHarness } from './release-harness'

const harness = releaseHarness('core_release_since')
const { f, h, recording, mergeTicket, refresh, setup, releaser, at, start, advance } = harness
const { states, deployed, ask, commentsOn, NOW } = harness

const once = <T extends object>(target: T, name: string, gate: { armed: boolean }): T =>
  new Proxy(target, {
    get: (from, key) => {
      const value: unknown = Reflect.get(from, key)
      if (key !== name || typeof value !== 'function' || !gate.armed) return value
      return () => {
        gate.armed = false
        return Promise.reject(new Error('forge unavailable'))
      }
    },
  })

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
    expect((await releasesPage(h.payload(), { workspace: h.ids.workspace, product: h.ids.product })).ready?.since).toBe(
      'v0.6.0',
    )
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

  it('keeps the last real release when a release was given up, and never proposes its version again', async () => {
    const s = await setup()
    const r = releaser()
    const first = await start(r)
    deployed(s, 'failure')
    await advance(r, first.id)
    await r.answer(at(), first.id, 'release-fixed-later')
    await refresh()
    const panel = await releasePanel(h.payload(), at(), NOW)
    expect(panel?.since).toBe('v0.6.0')
    expect(panel?.changes).toBe(2)
    expect(panel?.refusal).toBeNull()
    expect(panel?.proposal.version).toBe('v0.7.1')
  })

  it('proposes a patch for a fix that changes behaviour and a major only for an explicit breaking signal', async () => {
    const s = await setup({ merged: false })
    await mergeTicket(s.repo, 'Sign-in works again', 1, 'behaviour', true)
    await refresh()
    const fix = await releasePanel(h.payload(), at(), NOW)
    expect(fix?.proposal).toEqual({ version: 'v0.6.1', bump: 'patch' })
    await mergeTicket(s.repo, 'Drop the old export', 2, 'visible', false, '2026-11-22T11:00:00Z', ['Breaking'])
    await refresh()
    expect((await releasePanel(h.payload(), at(), NOW))?.proposal).toEqual({ version: 'v0.7.0', bump: 'major' })
  })

  it('treats a pull request title with the breaking mark as breaking', async () => {
    const s = await setup({ merged: false })
    await mergeTicket(s.repo, 'feat(core)!: Drop the old export', 1, 'visible')
    await refresh()
    expect((await releasePanel(h.payload(), at(), NOW))?.proposal.bump).toBe('major')
  })

  it.each([
    ['tag', 'draftRelease', 'forge', true],
    ['deploy', 'getRepository', 'forge', true],
    ['wait', null, 'forge', false],
    ['check', 'commitEndpoint', 'forge', false],
    ['publish', 'publishRelease', 'forge', false],
    ['tell', 'comment', 'tickets', false],
  ] as const)('stops after the %s step; a rerun makes one tag, release, deploy', async (_step, method, on, early) => {
    const s = await setup()
    const fake = f.fake()
    const gate = { armed: early }
    const forge = method !== null && on === 'forge' ? once(fake.forge, method, gate) : fake.forge
    const wrapped = (repo: string) => {
      const own = fake.tickets(repo)
      return method !== null && on === 'tickets' ? once(own, method, gate) : own
    }
    const r = releaser({ ...fake, forge, tickets: wrapped })
    const first = await start(r)
    let stops = 0
    const recover = async (run: { id: number; state: string }) => {
      if (run.state === 'failed') stops++
      if (run.state === 'failed') await r.answer(at(), first.id, 'check-again')
      await start(r)
      return advance(r, first.id)
    }
    await recover(first)
    deployed(s)
    gate.armed = method !== null && !early
    await recover(await advance(r, first.id))
    const done = await advance(r, first.id)
    expect(done.state).toBe('done')
    expect(stops).toBe(method === null ? 0 : 1)
    const names = await fake.forge.listTags(s.repo)
    expect(names.filter((name) => name === 'v0.7.0')).toHaveLength(1)
    expect(fake.listReleases(s.repo).filter((rel) => rel.tag === 'v0.7.0')).toHaveLength(1)
    expect(fake.deployStarts(s.repo)).toHaveLength(1)
    for (const issue of s.issues) expect(await commentsOn(s.repo, issue)).toHaveLength(1)
  })

  const publishedThenStopped = async () => {
    const s = await setup()
    const fake = f.fake()
    const gate = { armed: true }
    const r = releaser({ ...fake, tickets: (repo) => once(fake.tickets(repo), 'comment', gate) })
    const first = await start(r)
    deployed(s)
    const stopped = await advance(r, first.id)
    expect(states(stopped)).toEqual(expect.arrayContaining(['publish:done', 'tell:failed']))
    return { s, r, id: first.id }
  }

  it('offers only check-again after the notes are published and refuses giving up', async () => {
    const { r, id } = await publishedThenStopped()
    const failed = await releasePanel(h.payload(), at(), NOW)
    expect(failed?.run?.question?.options).toEqual(['check-again'])
    await r.answer(at(), id, 'release-fixed-later')
    expect((await releasePanel(h.payload(), at(), NOW))?.run?.state).toBe('failed')
  })

  it('counts a published release as the last one and marks the tickets on check again', async () => {
    const { s, r, id } = await publishedThenStopped()
    await refresh()
    expect((await releasePanel(h.payload(), at(), NOW))?.since).toBe('v0.7.0')
    await r.answer(at(), id, 'check-again')
    await refresh()
    const after = await releasePanel(h.payload(), at(), NOW)
    expect([after?.run, after?.since, after?.changes]).toEqual([null, 'v0.7.0', 0])
    for (const issue of s.issues) expect(await commentsOn(s.repo, issue)).toHaveLength(1)
  })
})
