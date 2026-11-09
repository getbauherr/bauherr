import { afterEach, describe, expect, it, vi } from 'vitest'
import { appVersion, changelog } from '../src/app/(app)/lib/version'

afterEach(() => vi.unstubAllEnvs())

describe('version helpers', () => {
  it('shows the release version the image was built with', () => {
    vi.stubEnv('BAUHERR_VERSION', '0.2.0')
    vi.stubEnv('BAUHERR_REVISION', 'abcdef1234')
    expect(appVersion()).toBe('0.2.0')
  })

  it('shows plain dev without a build version or revision', () => {
    vi.stubEnv('BAUHERR_VERSION', '')
    vi.stubEnv('BAUHERR_REVISION', '')
    expect(appVersion()).toBe('dev')
  })

  it('shows dev+<short sha> for a dev build with a revision', () => {
    vi.stubEnv('BAUHERR_VERSION', 'dev')
    vi.stubEnv('BAUHERR_REVISION', '6857912abc')
    expect(appVersion()).toBe('dev+6857912')
  })

  it('reads the repo changelog', () => {
    expect(changelog()).toContain('# Changelog')
  })
})
