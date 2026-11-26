import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { repoRoot } from './helpers/comments'

const readJson = (name: string): unknown => JSON.parse(readFileSync(join(repoRoot, name), 'utf8'))

const countOf = (suppressions: unknown): number =>
  Object.values(Object(suppressions) as Record<string, Record<string, { count: number }>>)
    .flatMap((rules) => Object.values(rules))
    .reduce((sum, rule) => sum + rule.count, 0)

test('the lint suppression count never grows past the ceiling', () => {
  const { count } = Object(readJson('eslint-suppressions.ceiling.json')) as { count: number }
  expect(
    countOf(readJson('eslint-suppressions.json')),
    'Fix the violation, do not suppress it. After removing some, lower count in eslint-suppressions.ceiling.json.',
  ).toBeLessThanOrEqual(count)
})
