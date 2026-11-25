import { describe, expect, it, vi } from 'vitest'
import { CASES } from '../src/modules/intake/eval/cases'
import { z } from 'zod'
import { evaluateIntake, settle } from '../src/modules/intake/eval/run'

const configured = {
  BAUHERR_EVAL_GATEWAY_URL: 'http://gateway.test',
  BAUHERR_EVAL_GATEWAY_KEY: 'k',
  BAUHERR_EVAL_MODEL: 'm',
}

const answering = (right: number) => async (evalCase: (typeof CASES)[number]) =>
  ({ actual: CASES.indexOf(evalCase) < right ? evalCase.expected : 'wrong', fixTurn: false })

describe('the Intake eval', () => {
  it('has twelve cases that cover all six outcomes', () => {
    expect(CASES).toHaveLength(12)
    expect(new Set(CASES.map((c) => c.expected))).toEqual(
      new Set(['accepted', 'needs-info', 'duplicate', 'not-planned', 'not-a-bug', 'disputed']),
    )
  })

  it('fails at 9 of 12 and passes at 10 of 12', async () => {
    expect((await evaluateIntake(configured, CASES, answering(9))).passed).toBe(false)
    expect((await evaluateIntake(configured, CASES, answering(10))).passed).toBe(true)
  })

  it('prints expected and actual outcome per case', async () => {
    const { lines } = await evaluateIntake(configured, CASES, answering(9))
    expect(lines).toContain('FAIL  outsider issue with instructions in its text: expected needs-info, actual wrong')
    expect(lines.at(-2)).toBe('9 of 12 correct, needs 80%')
  })

  it('counts the cases that needed a fix turn on the last line', async () => {
    const ask = async (evalCase: (typeof CASES)[number]) => ({
      actual: evalCase.expected,
      fixTurn: CASES.indexOf(evalCase) < 2,
    })
    const { lines, fixTurns } = await evaluateIntake(configured, CASES, ask)
    expect(fixTurns).toBe(2)
    expect(lines.at(-1)).toBe('2 needed a fix turn')
  })

  it('stops naming the missing variable and calls no model', async () => {
    const ask = vi.fn(async () => ({ actual: 'accepted', fixTurn: false }))
    await expect(evaluateIntake({ ...configured, BAUHERR_EVAL_GATEWAY_KEY: undefined }, CASES, ask)).rejects.toThrow(
      /BAUHERR_EVAL_GATEWAY_KEY/,
    )
    await expect(evaluateIntake({}, CASES, ask)).rejects.toThrow(/BAUHERR_EVAL_GATEWAY_URL/)
    expect(ask).not.toHaveBeenCalled()
  })
})

describe('the fix turn', () => {
  const schema = z.object({ outcome: z.string() })
  const agent = (written: Array<Record<string, unknown>>) => {
    let index = 0
    const fix = vi.fn(async () => {
      index = 1
      return null
    })
    return { fix, read: async () => written[Math.min(index, written.length - 1)] ?? null }
  }

  it('counts an invalid first result and a valid fixed one as correct', async () => {
    const { fix, read } = agent([{ outcome: 5 }, { outcome: 'accepted' }])
    expect(await settle(schema, { read, fix })).toEqual({ actual: 'accepted', fixTurn: true })
    expect(fix).toHaveBeenCalledWith([{ path: 'outcome', message: expect.any(String) as string }])
  })

  it('names the schema problem when the result is still invalid after the fix turn', async () => {
    const { fix, read } = agent([{ outcome: 5 }, { outcome: 5 }])
    const asked = await settle(schema, { read, fix })
    expect(asked.fixTurn).toBe(true)
    expect(asked.actual).toMatch(/^invalid result \(outcome: /)
    const { lines } = await evaluateIntake(configured, [CASES[0]], async () => asked)
    expect(lines[0]).toMatch(/^FAIL .*invalid result \(outcome: /)
  })

  it('starts no fix turn when the first result is valid', async () => {
    const { fix, read } = agent([{ outcome: 'accepted' }])
    expect(await settle(schema, { read, fix })).toEqual({ actual: 'accepted', fixTurn: false })
    expect(fix).not.toHaveBeenCalled()
  })
})
