import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execute } from '@bauherr/runner'
import { z } from 'zod'
import { missingFields } from '../src/core/intake/facts'
import { emptyRecord } from '../src/core/record/schema'
import type { ContextPack } from '../src/core/run/pack'
import { MAX_BUDGET_USD, MAX_TURNS, TIMEOUT_MS } from '../src/jobs/runner/deps'
import { FIX_PROMPT, PROMPT, readResult, writeContext, writeProblems } from '../src/jobs/runner/workdir'
import { skillFor, tierFor } from '../src/lean'
import { CASES, type EvalCase } from '../src/modules/intake/eval/cases'
import { evaluateIntake, settle, type Ask } from '../src/modules/intake/eval/run'
import { intake } from '../src/modules/intake/module'

const SOURCE = (runId: number) => ({
  forge: 'github' as const,
  repo: 'acme/widgets',
  number: 500 + runId,
  reporter: 'outsider',
  external: true,
  backlog: false,
})

const packFor = async (evalCase: EvalCase, runId: number): Promise<ContextPack> => ({
  runId,
  stage: 'intake',
  role: 'builder',
  model: { tier: await tierFor('builder') },
  record: emptyRecord(
    SOURCE(runId),
    evalCase.type,
  ),
  resultSchema: z.toJSONSchema(intake.resultSchema, { io: 'input' }),
  note: null,
  skill: await skillFor('intake', 'builder'),
  source: {
    issue: { number: 500 + runId, title: evalCase.title, author: 'outsider', body: evalCase.body, bodyCut: false },
    comments: [],
    olderCommentsLeftOut: 0,
    pull: null,
  },
  facts: {
    missing: missingFields(evalCase.type, evalCase.body),
    similar: evalCase.similar ?? [],
    rounds: evalCase.rounds ?? [],
  },
  agentsFile: null,
  memory: [],
  statements: [],
  similar: [],
})

const askModel =
  (url: string, key: string, model: string): Ask =>
  async (evalCase) => {
    const dir = await mkdtemp(join(tmpdir(), 'eval-intake-'))
    try {
      const runId = CASES.indexOf(evalCase) + 1
      await writeContext(dir, await packFor(evalCase, runId))
      const home = join(dir, '.home')
      await mkdir(home)
      const turn = (prompt: string) =>
        execute({
          runId: `eval-${runId}`,
          stage: 'intake',
          model,
          cwd: dir,
          home,
          prompt,
          readOnly: true,
          writablePaths: ['.bauherr/'],
          maxTurns: MAX_TURNS,
          maxBudgetUsd: MAX_BUDGET_USD,
          timeoutMs: TIMEOUT_MS,
          gatewayUrl: url,
          gatewayKey: key,
        })
      const first = await turn(PROMPT)
      if (!first.ok) return { actual: `run failed: ${first.reason}`, fixTurn: false }
      return settle(intake.resultSchema, {
        read: () => readResult(dir),
        fix: async (problems) => {
          await writeProblems(dir, problems)
          const fix = await turn(FIX_PROMPT)
          return fix.ok ? null : fix.reason
        },
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

const variables = process.env
try {
  const ask = askModel(
    variables.BAUHERR_EVAL_GATEWAY_URL ?? '',
    variables.BAUHERR_EVAL_GATEWAY_KEY ?? '',
    variables.BAUHERR_EVAL_MODEL ?? '',
  )
  const result = await evaluateIntake(variables, CASES, ask)
  console.log(result.lines.join('\n'))
  process.exit(result.passed ? 0 : 1)
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(2)
}
