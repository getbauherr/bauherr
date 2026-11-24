import { FakeBackend } from '@bauherr/adapters'
import { describe, expect, it } from 'vitest'
import { compareVersions, highestVersionTag, previousRange, resolveRange } from '../../src/core/insights/range'

const NOW = new Date('2026-04-01T00:00:00Z')

const forgeWith = () => {
  const backend = new FakeBackend()
  backend.addRelease('acme/app', { tag: 'v0.6.0', sha: 's1', createdAt: '2026-01-01T00:00:00Z' })
  backend.addTag('acme/app', 'v0.7.0-rc.2', 's2')
  backend.addRelease('acme/app', { tag: 'v0.7.0', sha: 's3', createdAt: '2026-03-01T00:00:00Z' })
  return backend.forge
}

describe('the range of a period', () => {
  it('takes two dates and puts the same length directly before', async () => {
    const input = { from: new Date('2026-03-10T00:00:00Z'), to: new Date('2026-03-20T00:00:00Z') }
    const range = await resolveRange(input, { now: NOW, repo: 'acme/app', forge: forgeWith() })
    expect(range).toEqual(input)
    expect(previousRange(range)).toEqual({ from: new Date('2026-02-28T00:00:00Z'), to: range.from })
  })

  it('refuses a range that does not start before it ends', async () => {
    const same = new Date('2026-03-10T00:00:00Z')
    const context = { now: NOW, repo: 'acme/app', forge: forgeWith() }
    await expect(resolveRange({ from: same, to: same }, context)).rejects.toThrow('start before')
  })

  it('takes a start the caller gives and runs until now', async () => {
    const since = new Date('2026-03-25T00:00:00Z')
    expect(await resolveRange({ since }, { now: NOW, repo: 'acme/app', forge: forgeWith() })).toEqual({
      from: since,
      to: NOW,
    })
  })

  it('starts at the date of a given version tag', async () => {
    const range = await resolveRange({ tag: 'v0.6.0' }, { now: NOW, repo: 'acme/app', forge: forgeWith() })
    expect(range).toEqual({ from: new Date('2026-01-01T00:00:00Z'), to: NOW })
  })

  it('resolves since the last release to the date of the highest version tag', async () => {
    const range = await resolveRange({ lastRelease: true }, { now: NOW, repo: 'acme/app', forge: forgeWith() })
    expect(range).toEqual({ from: new Date('2026-03-01T00:00:00Z'), to: NOW })
  })

  it('fails when there is no version tag or the tag has no date', async () => {
    const empty = { now: NOW, repo: 'acme/app', forge: new FakeBackend().forge }
    await expect(resolveRange({ lastRelease: true }, empty)).rejects.toThrow('no version tag')
    await expect(resolveRange({ tag: 'v9.9.9' }, empty)).rejects.toThrow('no release date')
  })

  it('orders versions by number, with a release above its pre-releases', () => {
    expect(highestVersionTag(['v0.9.0', 'v0.10.0', 'latest', 'v0.10.0-rc.1'])).toBe('v0.10.0')
    expect(highestVersionTag(['v1.0.0-rc.2', 'v1.0.0-rc.10', 'v0.9.9'])).toBe('v1.0.0-rc.10')
    expect(highestVersionTag(['nightly'])).toBeNull()
    expect(compareVersions('1.2.3', 'v1.2.3')).toBe(0)
  })
})
