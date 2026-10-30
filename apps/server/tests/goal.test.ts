import type { Payload } from 'payload'
import { expect, it } from 'vitest'
import { goalFor, goalOf } from '../src/lib/run-ctx'

const ac = '## Acceptance criteria\n- one\n- [ ] two\n'

it('uses the Acceptance criteria when present, whatever the stage', () => {
  expect(goalOf(`intro\n${ac}\n## Notes\nx`, 'build')).toEqual(['one', 'two'])
})

it('falls back to the stage default without criteria', () => {
  expect(goalOf('no criteria', 'plan')).toEqual(['a plan comment is posted'])
  expect(goalOf('no criteria', 'build')).toEqual(['MR linked on the Ticket'])
  expect(goalOf('no criteria', 'review')).toEqual(['review comments posted'])
})

it('inherits the parent criteria for child Tickets, own criteria win', async () => {
  const payload = { findByID: async () => ({ number: 7 }) } as unknown as Payload
  const ts = { get: async (n: string) => ({ body: n === '7' ? ac : '' }) }
  expect(await goalFor(payload, ts, { parent: 3 }, 'child', 'build')).toEqual(['one', 'two'])
  expect(await goalFor(payload, ts, { parent: 3 }, '## Acceptance criteria\n- own', 'build')).toEqual(['own'])
  expect(await goalFor(payload, ts, { parent: 3 }, 'child', 'release')).toEqual(['one', 'two'])
  expect(await goalFor(payload, { get: async () => ({ body: 'none' }) }, { parent: 3 }, 'child', 'build')).toEqual(['MR linked on the Ticket'])
  expect(await goalFor(payload, ts, {}, 'orphan', 'build')).toEqual(['MR linked on the Ticket'])
})
