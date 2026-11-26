import { describe, expect, it } from 'vitest'
import { bumpOf, nextVersion, validVersion } from '../../src/core/releases/version'

const change = (tags: string[], bug = false, breaking = false) => ({ bug, tags, breaking })

describe('proposed version', () => {
  it('makes a breaking change major, a new capability minor and only fixes patch', () => {
    expect(bumpOf([change(['visible']), change(['internal'], false, true)])).toBe('major')
    expect(bumpOf([change(['visible']), change(['internal'], true)])).toBe('minor')
    expect(bumpOf([change(['visible'], true), change(['internal'])])).toBe('patch')
    expect(bumpOf([])).toBe('patch')
  })

  it.each([
    ['a fix that changes behaviour', [change(['behaviour'], true)], 'patch', 'v0.6.1', 'v1.4.3'],
    ['a feature that changes behaviour', [change(['behaviour'])], 'patch', 'v0.6.1', 'v1.4.3'],
    ['a visible feature that changes behaviour', [change(['visible', 'behaviour'])], 'minor', 'v0.7.0', 'v1.5.0'],
    ['a breaking fix', [change(['behaviour'], true, true)], 'major', 'v0.7.0', 'v2.0.0'],
    ['a breaking feature', [change(['visible'], false, true)], 'major', 'v0.7.0', 'v2.0.0'],
  ] as const)('proposes for %s', (_name, tickets, bump, below, above) => {
    expect(bumpOf([...tickets])).toBe(bump)
    expect(nextVersion(['v0.6.0'], bumpOf([...tickets]))).toBe(below)
    expect(nextVersion(['v1.4.2'], bumpOf([...tickets]))).toBe(above)
  })

  it('raises the highest existing version', () => {
    expect(nextVersion(['v1.4.2', 'v1.3.0'], 'major')).toBe('v2.0.0')
    expect(nextVersion(['v1.4.2', 'v1.3.0'], 'minor')).toBe('v1.5.0')
    expect(nextVersion(['v1.4.2', 'v1.3.0'], 'patch')).toBe('v1.4.3')
  })

  it('makes a breaking change the next minor below 1.0', () => {
    expect(nextVersion(['v0.6.0', 'v0.5.0'], 'major')).toBe('v0.7.0')
    expect(nextVersion(['v0.6.0'], 'minor')).toBe('v0.7.0')
    expect(nextVersion(['v0.6.0'], 'patch')).toBe('v0.6.1')
  })

  it('keeps the prefix of the last tag and finishes a release candidate as its own version', () => {
    expect(nextVersion(['0.6.0'], 'minor')).toBe('0.7.0')
    expect(nextVersion(['v0.6.0', 'v0.7.0-rc.1'], 'minor')).toBe('v0.7.0')
  })

  it('never proposes a version that exists as a tag', () => {
    expect(nextVersion(['v0.6.0', '0.6.1'], 'patch')).toBe('0.6.2')
  })

  it('bases the proposal on the last real release, never on a release candidate', () => {
    expect(nextVersion(['v0.6.0', 'v0.8.0-rc.1'], 'minor')).toBe('v0.7.0')
    expect(nextVersion(['v0.6.0', 'v0.7.0-rc.2'], 'patch')).toBe('v0.6.1')
    expect(nextVersion(['v0.7.0-rc.1'], 'minor')).toBeNull()
  })

  it('has no proposal without a last version', () => {
    expect(nextVersion([], 'minor')).toBeNull()
  })

  it('refuses an existing, malformed or pre-release version from the owner', () => {
    const existing = ['v0.6.0']
    expect(validVersion('v0.7.0', existing)).toBe(true)
    expect(validVersion('0.6.0', existing)).toBe(false)
    expect(validVersion('v0.7', existing)).toBe(false)
    expect(validVersion('v0.7.0-rc.1', existing)).toBe(false)
  })
})
