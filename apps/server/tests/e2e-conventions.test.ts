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

const lines = (all: readonly (readonly [string, string])[], re: RegExp, allow: string) =>
  all.flatMap(([f, s]) => s.split('\n').map((l, i) => [`${f}:${i + 1}`, l] as const).filter(([, l]) => re.test(l) && !l.includes(allow)).map(([at]) => at))
const sources = readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'workflow-editor.spec.ts').map((f) => [f, readFileSync(join(dir, f), 'utf8')] as const) // the editor spec lives in its own PR (#513)

/** `page.request` sends no Origin/Sec-Fetch-Site, so Payload's cookie rule makes it anonymous on the production image: signed-in /api calls are fetched from the page. */
it('no /api call goes through page.request unless its line says allow-page-request', () => {
  expect(lines(sources, /page\.request\.\w+\(\s*[`'"]\/api/, 'allow-page-request')).toEqual([])
})

it('no fixed wait: waitForTimeout only where its line says allow-wait', () => {
  expect(lines(sources, /waitForTimeout\(/, 'allow-wait')).toEqual([])
})
