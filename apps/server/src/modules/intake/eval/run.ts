import type { EvalCase } from './cases'

export const THRESHOLD = 0.8

export const REQUIRED_VARIABLES = [
  'BAUHERR_EVAL_GATEWAY_URL',
  'BAUHERR_EVAL_GATEWAY_KEY',
  'BAUHERR_EVAL_MODEL',
] as const

export type Ask = (evalCase: EvalCase) => Promise<string>

export type Evaluation = { lines: string[]; correct: number; total: number; passed: boolean }

export type Variables = Record<string, string | undefined>

export const assertConfigured = (variables: Variables): void => {
  const missing = REQUIRED_VARIABLES.filter((name) => !variables[name])
  if (missing.length > 0) {
    throw new Error(`The Intake eval needs ${missing.join(', ')}. Set them and run again.`)
  }
}

export const evaluate = async (cases: EvalCase[], ask: Ask): Promise<Evaluation> => {
  const lines: string[] = []
  let correct = 0
  for (const evalCase of cases) {
    const actual = await ask(evalCase)
    const ok = actual === evalCase.expected
    if (ok) correct += 1
    lines.push(`${ok ? 'PASS' : 'FAIL'}  ${evalCase.name}: expected ${evalCase.expected}, actual ${actual}`)
  }
  const share = cases.length === 0 ? 0 : correct / cases.length
  lines.push(`${correct} of ${cases.length} correct, needs ${Math.round(THRESHOLD * 100)}%`)
  return { lines, correct, total: cases.length, passed: share >= THRESHOLD }
}

export const evaluateIntake = async (variables: Variables, cases: EvalCase[], ask: Ask): Promise<Evaluation> => {
  assertConfigured(variables)
  return evaluate(cases, ask)
}
