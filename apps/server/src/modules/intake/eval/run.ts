import { z } from 'zod'
import type { Problem } from '../../../core/module'
import type { EvalCase } from './cases'

export const THRESHOLD = 0.8

export const REQUIRED_VARIABLES = [
  'BAUHERR_EVAL_GATEWAY_URL',
  'BAUHERR_EVAL_GATEWAY_KEY',
  'BAUHERR_EVAL_MODEL',
] as const

export type Asked = { actual: string; fixTurn: boolean }

export type Ask = (evalCase: EvalCase) => Promise<Asked>

export type Evaluation = { lines: string[]; correct: number; total: number; passed: boolean; fixTurns: number }

export type Variables = Record<string, string | undefined>

export const assertConfigured = (variables: Variables): void => {
  const missing = REQUIRED_VARIABLES.filter((name) => !variables[name])
  if (missing.length > 0) {
    throw new Error(`The Intake eval needs ${missing.join(', ')}. Set them and run again.`)
  }
}

type Checked = { outcome: string } | { problems: Problem[] }

const check = (written: Record<string, unknown>, resultSchema: z.ZodType): Checked => {
  const checked = resultSchema.safeParse(written)
  if (!checked.success) {
    const problems = checked.error.issues.map((issue) => ({
      path: issue.path.join('.') || 'result',
      message: issue.message,
    }))
    return { problems }
  }
  const parsed = z.object({ outcome: z.string() }).safeParse(written)
  return parsed.success ? { outcome: parsed.data.outcome } : { problems: [{ path: 'outcome', message: 'missing' }] }
}

const invalid = (problems: Problem[]): string => `invalid result (${problems[0]?.path}: ${problems[0]?.message})`

export type SettleSteps = {
  read: () => Promise<Record<string, unknown> | null>
  fix: (problems: Problem[]) => Promise<string | null>
}

export const settle = async (resultSchema: z.ZodType, { read, fix }: SettleSteps): Promise<Asked> => {
  const first = await read()
  if (first === null) return { actual: 'no result written', fixTurn: false }
  const firstCheck = check(first, resultSchema)
  if ('outcome' in firstCheck) return { actual: firstCheck.outcome, fixTurn: false }
  const failure = await fix(firstCheck.problems)
  if (failure !== null) return { actual: `run failed: ${failure}`, fixTurn: true }
  const second = await read()
  if (second === null) return { actual: 'no result written', fixTurn: true }
  const secondCheck = check(second, resultSchema)
  return { actual: 'outcome' in secondCheck ? secondCheck.outcome : invalid(secondCheck.problems), fixTurn: true }
}

export const evaluate = async (cases: EvalCase[], ask: Ask): Promise<Evaluation> => {
  const lines: string[] = []
  let correct = 0
  let fixTurns = 0
  for (const evalCase of cases) {
    const { actual, fixTurn } = await ask(evalCase)
    if (fixTurn) fixTurns += 1
    const ok = actual === evalCase.expected
    if (ok) correct += 1
    lines.push(`${ok ? 'PASS' : 'FAIL'}  ${evalCase.name}: expected ${evalCase.expected}, actual ${actual}`)
  }
  const share = cases.length === 0 ? 0 : correct / cases.length
  lines.push(`${correct} of ${cases.length} correct, needs ${Math.round(THRESHOLD * 100)}%`)
  lines.push(`${fixTurns} needed a fix turn`)
  return { lines, correct, total: cases.length, passed: share >= THRESHOLD, fixTurns }
}

export const evaluateIntake = async (variables: Variables, cases: EvalCase[], ask: Ask): Promise<Evaluation> => {
  assertConfigured(variables)
  return evaluate(cases, ask)
}
