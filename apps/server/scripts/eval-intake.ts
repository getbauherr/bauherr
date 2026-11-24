import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execute, WORK_DIR } from '@bauherr/runner'
import { z } from 'zod'
import { missingFields } from '../src/core/intake/facts'
import { emptyRecord } from '../src/core/record/schema'
import type { ContextPack } from '../src/core/run/pack'
import { MAX_BUDGET_USD, MAX_TURNS, TIMEOUT_MS } from '../src/jobs/runner/deps'
import { PROMPT, readResult, writeContext } from '../src/jobs/runner/workdir'
import { skillFor, tierFor } from '../src/lean'
import { CASES, type EvalCase } from '../src/modules/intake/eval/cases'
import { evaluateIntake, type Ask } from '../src/modules/intake/eval/run'
import { intake } from '../src/modules/intake/module'

const ISSUE_NOTE =
  ' There is no forge mirror here: the issue itself is in .bauherr/issue.json (title, body); the repository is empty.'

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
  facts: {
    missing: missingFields(evalCase.type, evalCase.body),
    similar: evalCase.similar ?? [],
    rounds: evalCase.rounds ?? [],
  },
  agentsFile: null,
  memory: [],
  statements: [],
  similar: [],
  learn: null,
})

const outcomeOf = (written: Record<string, unknown> | null): string => {
  if (written === null) return 'no result written'
  const parsed = z.object({ outcome: z.string() }).safeParse(written)
  return intake.resultSchema.safeParse(written).success && parsed.success ? parsed.data.outcome : 'invalid result'
}

const askModel =
  (url: string, key: string, model: string): Ask =>
  async (evalCase) => {
    const dir = await mkdtemp(join(tmpdir(), 'eval-intake-'))
    try {
      const runId = CASES.indexOf(evalCase) + 1
      await writeContext(dir, await packFor(evalCase, runId))
      await writeFile(join(dir, WORK_DIR, 'issue.json'), JSON.stringify({ title: evalCase.title, body: evalCase.body }))
      const home = join(dir, '.home')
      await mkdir(home)
      const done = await execute({
        runId: `eval-${runId}`,
        stage: 'intake',
        model,
        cwd: dir,
        home,
        prompt: PROMPT + ISSUE_NOTE,
        readOnly: true,
        writablePaths: ['.bauherr/'],
        maxTurns: MAX_TURNS,
        maxBudgetUsd: MAX_BUDGET_USD,
        timeoutMs: TIMEOUT_MS,
        gatewayUrl: url,
        gatewayKey: key,
      })
      return done.ok ? outcomeOf(await readResult(dir)) : `run failed: ${done.reason}`
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
