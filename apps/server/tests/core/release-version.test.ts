import { describe, expect, it } from 'vitest'
import { bumpOf, nextVersion, validVersion } from '../../src/core/releases/version'

const change = (tags: string[], bug = false) => ({ bug, tags })

describe('proposed version', () => {
  it('makes a breaking change major, a new capability minor and only fixes patch', () => {
    expect(bumpOf([change(['visible']), change(['behaviour'])])).toBe('major')
    expect(bumpOf([change(['visible']), change(['internal'], true)])).toBe('minor')
    expect(bumpOf([change(['visible'], true), change(['internal'])])).toBe('patch')
    expect(bumpOf([])).toBe('patch')
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
