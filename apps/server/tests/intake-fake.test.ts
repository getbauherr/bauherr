import { describe, expect, it } from 'vitest'
import { nextTurn, type Session } from '../src/lib/intake/engine'
import { fakeModel } from '../src/lib/intake/fake'

describe('fake intake model', () => {
  it('reaches a ready draft on the third answer', async () => {
    let s: Session = { messages: [], draft: null }
    const ready: boolean[] = []
    for (const text of ['The invoice total is wrong', 'Finance, last week', 'Totals should match']) {
      const r = await nextTurn(s, text, fakeModel)
      s = r.session
      ready.push(r.ready)
    }
    expect(ready).toEqual([false, false, true])
  })
})
