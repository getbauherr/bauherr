import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { dbSuffix, testDbName } from './helpers/test-db'

const server = fileURLToPath(new URL('..', import.meta.url))
const files = (dir: string): string[] =>
  readdirSync(join(server, dir), { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith('.ts'))
    .map((e) => join(e.parentPath, e.name))

it('only helpers/test-db.ts names or creates test databases', () => {
  const offenders = ['tests', 'e2e', 'scripts']
    .flatMap(files)
    .map((f) => relative(server, f))
    .filter((f) => f !== 'tests/helpers/test-db.ts' && f !== 'tests/no-hardcoded-test-db.test.ts')
    .filter((f) => /CREATE DATABASE|bauherr_test/.test(readFileSync(join(server, f), 'utf8')))
  expect(offenders).toEqual([])
})

it('derives the suffix from VITEST_DB_SUFFIX, CI, or the repo root', () => {
  expect(dbSuffix('/a', { CI: '1' })).toBe('')
  expect(dbSuffix('/a', { CI: '1', VITEST_DB_SUFFIX: '185' })).toBe('185')
  expect(dbSuffix('/a', {})).toMatch(/^[0-9a-f]{6}$/)
  expect(dbSuffix('/a', {})).not.toBe(dbSuffix('/b', {}))
  expect(testDbName('session', '')).toBe('bauherr_test_session')
  expect(testDbName('session', 'ab12cd')).toBe('bauherr_test_session_ab12cd')
  expect(() => testDbName('x'.repeat(60), 'ab12cd')).toThrow()
})
