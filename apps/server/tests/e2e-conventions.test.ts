import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const dir = join(__dirname, '..', 'e2e')
const specs = readdirSync(dir).filter((f) => f.endsWith('.spec.ts')).map((f) => [f, readFileSync(join(dir, f), 'utf8')] as const)

/** The e2e-fake job runs 3 workers: see CONTRIBUTING.md (one admin per worker, own users for sign-out). */
it('no spec reads E2E_EMAIL itself: the worker user comes from e2e/user.ts', () => {
  expect(specs.filter(([, s]) => /const email = process\.env\.E2E_EMAIL/.test(s)).map(([f]) => f)).toEqual([])
})

it('a spec that signs out signs in as a signout-*/draft-owner user, never as the worker admin', () => {
  const offenders = specs.filter(([, s]) => /Sign out|logout\(/.test(s) && /from '\.\/user'/.test(s) && /fill\(email\)/.test(s)).map(([f]) => f)
  expect(offenders).toEqual([])
})
