import { expect, test } from 'vitest'
import { registryProblems } from '../scripts/registry-lock'

test('every ui and assistant-ui element file is listed in registry.lock.json with its source', () => {
  expect(registryProblems()).toEqual([])
})
