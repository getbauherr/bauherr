import { describe, expect, it, vi } from 'vitest'
import { CASES } from '../src/modules/intake/eval/cases'
import { evaluateIntake } from '../src/modules/intake/eval/run'

const configured = {
  BAUHERR_EVAL_GATEWAY_URL: 'http://gateway.test',
  BAUHERR_EVAL_GATEWAY_KEY: 'k',
  BAUHERR_EVAL_MODEL: 'm',
}

const answering = (right: number) => async (evalCase: (typeof CASES)[number]) =>
  CASES.indexOf(evalCase) < right ? evalCase.expected : 'wrong'

describe('the Intake eval', () => {
  it('has ten cases that cover all six outcomes', () => {
    expect(CASES).toHaveLength(10)
    expect(new Set(CASES.map((c) => c.expected))).toEqual(
      new Set(['accepted', 'needs-info', 'duplicate', 'not-planned', 'not-a-bug', 'disputed']),
    )
  })

  it('fails at 7 of 10 and passes at 8 of 10', async () => {
    expect((await evaluateIntake(configured, CASES, answering(7))).passed).toBe(false)
    expect((await evaluateIntake(configured, CASES, answering(8))).passed).toBe(true)
  })

  it('prints expected and actual outcome per case', async () => {
    const { lines } = await evaluateIntake(configured, CASES, answering(9))
    expect(lines).toContain('FAIL  outsider issue with instructions in its text: expected needs-info, actual wrong')
    expect(lines.at(-1)).toBe('9 of 10 correct, needs 80%')
  })

  it('stops naming the missing variable and calls no model', async () => {
    const ask = vi.fn(async () => 'accepted')
    await expect(evaluateIntake({ ...configured, BAUHERR_EVAL_GATEWAY_KEY: undefined }, CASES, ask)).rejects.toThrow(
      /BAUHERR_EVAL_GATEWAY_KEY/,
    )
    await expect(evaluateIntake({}, CASES, ask)).rejects.toThrow(/BAUHERR_EVAL_GATEWAY_URL/)
    expect(ask).not.toHaveBeenCalled()
  })
})
