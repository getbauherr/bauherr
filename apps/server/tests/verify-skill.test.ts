import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { CHECKS_FIX } from '../src/core/gate'

const skill = readFileSync(join(__dirname, '..', '..', '..', 'pack/skills/verify.md'), 'utf8').replace(/\s+/g, ' ')

it('the Verify skill tells verifiers what the checks gate enforces', () => {
  expect(skill).toContain(CHECKS_FIX)
  expect(skill).toMatch(/red or pending, a criterion verified by a test or command stays `open`/)
  expect(skill).toMatch(/`partial` is for a criterion met in part on a green commit/)
})

it('the Verify skill states the one-round and follow-up rules', () => {
  expect(skill).toMatch(/Report everything you find in one round/)
  expect(skill).toMatch(/check it in round 1/)
  expect(skill).toMatch(/with `followUp` set to true/)
})
