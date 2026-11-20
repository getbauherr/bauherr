import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const dir = join(__dirname, '..', 'e2e')
const specs = readdirSync(dir)
  .filter((f) => f.endsWith('.spec.ts'))
  .map((f) => [f, readFileSync(join(dir, f), 'utf8')] as const)

it('no spec reads E2E_EMAIL itself: the worker user comes from e2e/user.ts', () => {
  expect(specs.filter(([, s]) => /const email = process\.env\.E2E_EMAIL/.test(s)).map(([f]) => f)).toEqual([])
})

it('a spec that signs out signs in as a signout-*/draft-owner user, never as the worker admin', () => {
  const offenders = specs
    .filter(([, s]) => /Sign out|logout\(/.test(s) && /from '\.\/user'/.test(s) && /fill\(email\)/.test(s))
    .map(([f]) => f)
  expect(offenders).toEqual([])
})

const lines = (all: readonly (readonly [string, string])[], re: RegExp) =>
  all.flatMap(([f, s]) =>
    s
      .split('\n')
      .map((l, i) => [`${f}:${i + 1}`, l] as const)
      .filter(([, l]) => re.test(l))
      .map(([at]) => at),
  )
const sources = readdirSync(dir)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => [f, readFileSync(join(dir, f), 'utf8')] as const)

it('no /api call goes through page.request: take the page-evaluated fetch, or name the probe anonymousApiProbe', () => {
  expect(lines(sources, /page\.request\.\w+\(\s*[`'"]\/api/)).toEqual([])
})

it('no fixed wait: wait on the visible end signal of the step, not on time', () => {
  expect(lines(sources, /waitForTimeout\(/)).toEqual([])
})
