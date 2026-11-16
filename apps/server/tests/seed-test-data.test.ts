import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from 'vitest'

const seed = readFileSync(resolve(__dirname, '../scripts/seed-e2e.ts'), 'utf8')

test('the screenshot seed holds only @example.com addresses', () => {
  const emails = seed.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? []
  expect(emails.length).toBeGreaterThan(0)
  expect(emails.filter((e) => !e.endsWith('@example.com'))).toEqual([])
})

test('the screenshot seed holds no token-shaped strings', () => {
  expect(seed.match(/\b(?:ghp|gho|ghs|github_pat|glpat|sk|bhm|xox[bpa])[_-][\w-]{4,}|\b[0-9a-f]{32,}\b|\beyJ[\w-]{10,}\.[\w-]{10,}/g) ?? []).toEqual([])
})
