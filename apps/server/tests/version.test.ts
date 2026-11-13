import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appVersion, changelog } from '../src/app/(app)/lib/version'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('version helpers', () => {
  it('shows the release version the image was built with', () => {
    vi.stubEnv('BAUHERR_VERSION', '0.2.0')
    vi.stubEnv('BAUHERR_REVISION', 'abcdef1234')
    expect(appVersion()).toBe('v0.2.0')
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

  it('adds the build day to a release version', () => {
    vi.stubEnv('BAUHERR_VERSION', '1.2.3')
    vi.stubEnv('BAUHERR_BUILD_DATE', '2026-11-11T16:42:10Z')
    expect(appVersion()).toBe('v1.2.3 · 2026-11-11')
  })

  it('shows the build time in UTC and the short sha for a dev build', () => {
    vi.stubEnv('BAUHERR_VERSION', 'dev')
    vi.stubEnv('BAUHERR_REVISION', '5a1112f9999')
    vi.stubEnv('BAUHERR_BUILD_DATE', '2026-11-11T16:42Z')
    expect(appVersion()).toBe('dev · 2026-11-11 16:42 UTC · 5a1112f')
    vi.stubEnv('BAUHERR_REVISION', '')
    expect(appVersion()).toBe('dev · 2026-11-11 16:42 UTC')
  })

  it('ignores an unreadable build date', () => {
    vi.stubEnv('BAUHERR_VERSION', 'dev')
    vi.stubEnv('BAUHERR_REVISION', '6857912abc')
    vi.stubEnv('BAUHERR_BUILD_DATE', 'yesterday')
    expect(appVersion()).toBe('dev+6857912')
  })

  it('reads the repo changelog', () => {
    expect(changelog()).toContain('# Changelog')
  })

  describe('an image built without BAUHERR_BUILD_DATE', () => {
    const imageAt = async (nodeEnv: string) => {
      const dir = mkdtempSync(path.join(tmpdir(), 'bauherr-version-'))
      mkdirSync(path.join(dir, '.next'))
      const id = path.join(dir, '.next/BUILD_ID')
      writeFileSync(id, 'x')
      const t = new Date('2026-11-13T13:20:53Z')
      utimesSync(id, t, t)
      vi.spyOn(process, 'cwd').mockReturnValue(dir)
      vi.stubEnv('NODE_ENV', nodeEnv)
      vi.stubEnv('BAUHERR_VERSION', 'dev')
      vi.stubEnv('BAUHERR_REVISION', '19ece9b1234')
      vi.stubEnv('BAUHERR_BUILD_DATE', '')
      return (await import('../src/app/(app)/lib/version')).appVersion()
    }

    it('shows the time next build ran, in UTC, with the short sha', async () => {
      expect(await imageAt('production')).toBe('dev · 2026-11-13 13:20 UTC · 19ece9b')
    })

    it('shows no time outside production', async () => {
      expect(await imageAt('test')).toBe('dev+19ece9b')
    })

    it('falls back to the sha when the build marker is missing', async () => {
      vi.spyOn(process, 'cwd').mockReturnValue(mkdtempSync(path.join(tmpdir(), 'bauherr-version-')))
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('BAUHERR_VERSION', 'dev')
      vi.stubEnv('BAUHERR_REVISION', '19ece9b1234')
      vi.stubEnv('BAUHERR_BUILD_DATE', '')
      expect((await import('../src/app/(app)/lib/version')).appVersion()).toBe('dev+19ece9b')
    })
  })
})
