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
})

it('inherits the parent criteria for child Tickets, own criteria win', async () => {
  const payload = { findByID: async () => ({ number: 7, workspace: 1, product: 1 }) } as unknown as Payload
  expect(goalOf('child', 'build', ac)).toEqual(['one', 'two'])
  expect(goalOf('## Acceptance criteria\n- own', 'build', ac)).toEqual(['own'])
  // no parent, or a parent whose forge read fails: stage default
  expect(await goalFor(payload, {}, 'orphan', 'build')).toEqual(['MR linked on the Ticket'])
  expect(await goalFor(payload, { parent: 3, workspace: 2 }, 'child', 'build')).toEqual(['MR linked on the Ticket'])
  expect(await goalFor(payload, { parent: 3, workspace: 1 }, 'child', 'build')).toEqual(['MR linked on the Ticket'])
})
