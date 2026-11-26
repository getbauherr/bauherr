import { describe, expect, it } from 'vitest'
import { gate, type GateFacts } from '../../src/core/gate'
import { fold, next } from '../../src/core/lifecycle'
import { STATE_OUTCOMES, type Criterion, type Finding, type StateRow } from '../../src/core/record/schema'
import { stateTableProblems } from '../../src/core/record/state-table'
import { verifyResultSchema } from '../../src/core/verify-result'
import { summarize } from '../../src/core/views/insights'
import { briefed, CONFIG, ev, inShip } from './fixtures'

describe('a branch brought up to date', () => {
  it('moves the patch head and the verdict head, and waits for the checks of the new head', () => {
    const state = fold([...inShip, ev('pull.updated', { patchId: 'p1', headSha: 'h2' })])
    expect(state).toMatchObject({ patch: { headSha: 'h2' }, verdict: { headSha: 'h2' }, checks: 'pending' })
    expect(next(briefed(), state, CONFIG)).toEqual({ kind: 'wait', on: 'checks' })
  })

  it('merges once the checks of the new head passed', () => {
    const state = fold([...inShip, ev('pull.updated', { headSha: 'h2' }), ev('checks.finished')])
    expect(next(briefed(), state, CONFIG)).toEqual({ kind: 'effect', effect: 'merge' })
  })

  it('ignores another patch', () => {
    const state = fold([...inShip, ev('pull.updated', { patchId: 'old', headSha: 'h2' })])
    expect(state.patch?.headSha).toBe('h1')
  })
})

const facts: GateFacts = {
  buildClaimedBy: null,
  verifyHeldBy: null,
  patch: { id: 'p1', headSha: 'h1' },
  headCommit: 'h1',
  checks: 'passed',
  proofIds: ['9'],
  failedProofIds: [],
  screens: [],
  shots: [],
}

const finding = (followUp?: boolean): Finding => ({
  id: 'f1',
  axis: 'spec',
  text: 'An old gap',
  evidence: { kind: 'repro', pointer: 'open the page' },
  status: 'open',
  ...(followUp === undefined ? {} : { followUp }),
})

const result = (verdict: 'pass' | 'changes', findings: Finding[]) =>
  verifyResultSchema.parse({
    headSha: 'h1',
    patchId: 'p1',
    criteria: ['c1', 'c2', 'c3'].map((id) => ({ id, status: 'met', proof: ['9'] })),
    findings,
    verdict,
    changes: [],
    walkthrough: [],
    notVerified: [],
  })

const met = (c: Criterion): Criterion => ({ ...c, status: 'met', proof: ['9'] })
const record = () => briefed({ criteria: briefed().criteria.map(met) })

describe('findings marked as follow-ups', () => {
  it('lets a pass stand while a follow-up is open', () => {
    const outcome = gate({ result: result('pass', [finding(true)]), record: record(), facts })
    expect(outcome.accepted).toBe(true)
  })

  it('still refuses a pass while a finding that is not a follow-up is open', () => {
    const outcome = gate({ result: result('pass', [finding()]), record: record(), facts })
    expect(outcome.accepted).toBe(false)
    expect(JSON.stringify(outcome)).toContain('f1')
  })

  it('does not accept changes that rest only on a follow-up', () => {
    const outcome = gate({ result: result('changes', [finding(true)]), record: record(), facts })
    expect(outcome.accepted).toBe(false)
    expect(JSON.stringify(outcome)).toContain('unproven')
  })

  it('accepts changes that rest on a finding that is not a follow-up', () => {
    expect(gate({ result: result('changes', [finding()]), record: record(), facts }).accepted).toBe(true)
  })
})

const table = (steps: string[], skip?: [string, string]): StateRow[] =>
  steps.flatMap((step) =>
    STATE_OUTCOMES.filter((outcome) => skip?.[0] !== step || skip[1] !== outcome).map((outcome) => ({
      step,
      outcome,
      test: `${step} is ${outcome}`,
    })),
  )

describe('the state table of a Brief', () => {
  it('accepts every step with all four outcomes and one test per row', () => {
    expect(stateTableProblems(table(['build', 'deploy']))).toEqual([])
    expect(stateTableProblems([])).toEqual([])
  })

  it.each(STATE_OUTCOMES)('refuses a step without its %s row', (outcome) => {
    const problems = stateTableProblems(table(['build', 'deploy'], ['deploy', outcome]))
    expect(problems).toHaveLength(1)
    expect(problems[0]?.message).toContain(`step "deploy" has no row for ${outcome}`)
  })

  it('refuses a test that serves two rows', () => {
    const rows = table(['deploy'])
    const problems = stateTableProblems(rows.map((row) => ({ ...row, test: 'one test' })))
    expect(problems).toHaveLength(3)
  })
})

describe('verify rounds in the Insights summary', () => {
  const ticket = (verifyRounds: number) => ({
    createdAt: new Date(0),
    doneAt: new Date(60_000),
    closed: false,
    seconds: 60,
    stays: [],
    you: 0,
    verifyRounds,
    sentBack: 0,
    briefsChanged: 0,
  })

  it('gives the median and the share of tickets with more than one round', () => {
    const time = summarize([ticket(0), ticket(1), ticket(3), ticket(2)])
    expect(time.verifyRoundsMedian).toBe(1.5)
    expect(time.moreThanOneRoundShare).toBe(0.5)
  })

  it('has no figure without tickets', () => {
    const time = summarize([])
    expect(time.verifyRoundsMedian).toBeNull()
    expect(time.moreThanOneRoundShare).toBeNull()
  })
})
