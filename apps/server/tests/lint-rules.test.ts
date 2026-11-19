import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import config from '../../../eslint.config.mjs'
import { repoRoot } from './helpers/comments'

type Restriction = { where: string; text: string | undefined }

const RESTRICTION_RULES = [
  'no-restricted-syntax',
  'no-restricted-imports',
  'no-restricted-properties',
  'no-restricted-globals',
]
const FIX_VERBS = [
  'move', 'pass', 'use', 'call', 'go', 'take', 'read', 'name', 'parse', 'narrow', 'fix', 'schedule',
  'add', 'replace', 'delete', 'end', 'let', 'change', 'put', 'import', 'write', 'keep', 'split',
].join('|')
const FIX_SENTENCE = new RegExp(`(^|[.:]\\s+)(${FIX_VERBS})\\b`, 'i')

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? Object.fromEntries(Object.entries(value)) : {}
const asText = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)
const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

const entriesOf = (rule: string, options: unknown[]): Restriction[] =>
  options.flatMap((option): Restriction[] => {
    if (typeof option === 'string') return [{ where: `${rule} ${option}`, text: undefined }]
    const record = asRecord(option)
    const nested = [...asList(record.patterns), ...asList(record.paths)]
    if (nested.length > 0) return entriesOf(rule, nested)
    const label = asText(record.selector) ?? asText(record.name) ?? JSON.stringify(record.group ?? record)
    return [{ where: `${rule} ${label}`, text: asText(record.message) }]
  })

const restrictionsWithoutInstruction = (configs: unknown[]): string[] =>
  configs.flatMap((entry) => {
    const rules = asRecord(asRecord(entry).rules)
    return RESTRICTION_RULES.flatMap((rule) =>
      entriesOf(rule, asList(rules[rule]).slice(1))
        .filter((r) => !r.text || !FIX_SENTENCE.test(r.text))
        .map((r) => r.where),
    )
  })

const MESSAGE_HELP =
  'Give the restriction a message with two parts: what is wrong, then what to do instead ' +
  '(for example "Modules do not import each other. Move the shared code into src/core or pass it through the record.").'

test('every hand-written restriction in eslint.config.mjs has a message that names the fix', () => {
  expect(restrictionsWithoutInstruction(config), MESSAGE_HELP).toEqual([])
})

test('the check finds a missing message and one that only states the violation', () => {
  const syntax = [{ selector: 'Identifier' }, { selector: 'Literal', message: 'Literals are not allowed here.' }]
  const imports = [{ patterns: [{ group: ['**/x'], message: 'Use the helper in src/core.' }] }]
  const bad = [
    { rules: { 'no-restricted-syntax': ['error', ...syntax] } },
    { rules: { 'no-restricted-imports': ['error', ...imports] } },
  ]
  expect(restrictionsWithoutInstruction(bad)).toEqual([
    'no-restricted-syntax Identifier',
    'no-restricted-syntax Literal',
  ])
})

test('the suppressions file holds no entry for src/core or src/modules', () => {
  const file = join(repoRoot, 'eslint-suppressions.json')
  const suppressed = existsSync(file) ? Object.keys(asRecord(JSON.parse(readFileSync(file, 'utf8')))) : []
  const forbidden = suppressed.filter((path) => /\/src\/(core|modules)\//.test(`/${path}`))
  expect(
    forbidden,
    'Fix the violation instead of suppressing it: new code under src/core and src/modules has no baseline.',
  ).toEqual([])
})
