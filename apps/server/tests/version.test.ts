import { describe, expect, it } from 'vitest'
import { appVersion, changelog } from '../src/app/(app)/lib/version'

describe('version helpers', () => {
  it('reads the package version', () => {
    expect(appVersion()).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('reads the repo changelog', () => {
    expect(changelog()).toContain('# Changelog')
  })
})
