import { describe, expect, it } from 'vitest'
import { diffLines, driftOf } from '../../src/core/record/diff'

const shape = ['- src/list.ts: query()', '+ src/list.ts: query(limit)', '  src/page.tsx'].join('\n')

describe('diffLines', () => {
  it('marks added, removed and unchanged lines and skips blank ones', () => {
    expect(diffLines('+a\n\n-b\n c\nd')).toEqual([
      { mark: '+', text: 'a' },
      { mark: '-', text: 'b' },
      { mark: ' ', text: ' c' },
      { mark: ' ', text: 'd' },
    ])
  })
})

describe('driftOf', () => {
  it('flags every changed line of the built outline that the plan did not have', () => {
    const built = [shape, '+ src/cache.ts: new'].join('\n')
    const flagged = driftOf(shape, built).filter((line) => !line.inPlan)
    expect(flagged).toEqual([{ mark: '+', text: ' src/cache.ts: new', inPlan: false }])
  })

  it('ignores indentation when matching planned lines and never flags context lines', () => {
    expect(driftOf('+  a', '+ a\n b').map((line) => line.inPlan)).toEqual([true, true])
  })

  it('flags a removed line that was planned as an addition', () => {
    expect(driftOf('+a', '-a').map((line) => line.inPlan)).toEqual([false])
  })
})
