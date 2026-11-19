export const TEST_BUILD = process.env.BAUHERR_TEST_BUILD === '1'

export const fakeAllowed = (env: { NODE_ENV?: string }, testBuild: boolean): boolean => env.NODE_ENV !== 'production' || testBuild

export const assertFakeAllowed = (name: 'BAUHERR_E2E_FAKE_FORGE'): void => {
  if (process.env[name] === '1' && !fakeAllowed(process.env, TEST_BUILD)) throw new Error(`${name} must not be set in production`)
}
