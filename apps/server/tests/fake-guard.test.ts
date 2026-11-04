import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const root = path.resolve(import.meta.dirname, '../../..')
const load = async (marker: string, env: Record<string, string>) => {
  vi.resetModules()
  vi.stubEnv('BAUHERR_TEST_BUILD', marker)
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
}
afterEach(() => vi.unstubAllEnvs())

it('fakeAllowed: only outside production or in a test build', async () => {
  const { fakeAllowed } = await import('../src/lib/fake-guard')
  expect(fakeAllowed({ NODE_ENV: 'production' }, false)).toBe(false)
  expect(fakeAllowed({ NODE_ENV: 'production' }, true)).toBe(true)
  expect(fakeAllowed({ NODE_ENV: 'development' }, false)).toBe(true)
  expect(fakeAllowed({}, false)).toBe(true)
})

describe.each(['BAUHERR_E2E_FAKE_FORGE', 'INTAKE_FAKE'] as const)('assertFakeAllowed(%s)', (name) => {
  const assertWith = async (marker: string, env: Record<string, string>) => {
    await load(marker, { [name]: '', ...env })
    return (await import('../src/lib/fake-guard')).assertFakeAllowed(name)
  }
  it('throws in production without the marker', async () => {
    await expect(assertWith('', { NODE_ENV: 'production', [name]: '1' })).rejects.toThrow('must not be set in production')
  })
  it('passes with the marker, without the flag, or outside production', async () => {
    await expect(assertWith('1', { NODE_ENV: 'production', [name]: '1' })).resolves.toBeUndefined()
    await expect(assertWith('', { NODE_ENV: 'production' })).resolves.toBeUndefined()
    await expect(assertWith('', { NODE_ENV: 'test', [name]: '1' })).resolves.toBeUndefined()
  })
})

it('refuses to load the fakes in production without the marker', async () => {
  await load('', { NODE_ENV: 'production', BAUHERR_E2E_FAKE_FORGE: '1', INTAKE_FAKE: '1' })
  await expect(import('../src/lib/adapters')).rejects.toThrow('must not be set in production')
  vi.resetModules()
  await expect(import('../src/lib/intake/fake')).rejects.toThrow('must not be set in production')
})

it.each(['Dockerfile', 'compose.yaml'])('%s sets neither the marker nor the fake flags', (file) => {
  expect(readFileSync(path.join(root, file), 'utf8')).not.toMatch(/BAUHERR_TEST_BUILD|BAUHERR_E2E_FAKE_FORGE|INTAKE_FAKE/)
})
