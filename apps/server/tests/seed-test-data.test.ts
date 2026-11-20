import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from 'vitest'

const seed = readFileSync(resolve(__dirname, '../scripts/seed-e2e.ts'), 'utf8')

test('the screenshot seed holds only @example.com addresses', () => {
  const emails = seed.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? []
  expect(emails.length).toBeGreaterThan(0)
  expect(emails.filter((e) => !e.endsWith('@example.com'))).toEqual([])
})

const TOKEN_SHAPED = new RegExp(
  [
    String.raw`\b(?:ghp|gho|ghs|github_pat|glpat|sk|bhm|xox[bpa])[_-][\w-]{4,}`,
    String.raw`\b[0-9a-f]{32,}\b`,
    String.raw`\beyJ[\w-]{10,}\.[\w-]{10,}`,
    String.raw`\bAKIA[0-9A-Z]{16}\b`,
    String.raw`\bAIza[\w-]{35}`,
    String.raw`-----BEGIN [A-Z ]*PRIVATE KEY`,
  ].join('|'),
  'g',
)

test('the screenshot seed holds no token-shaped strings', () => {
  expect(seed.match(TOKEN_SHAPED) ?? []).toEqual([])
})
