import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { WORK_DIR } from '@bauherr/runner'
import type { Problem } from '../../core/module'
import type { ContextPack } from '../../core/run/pack'

export const FACT_FIELDS = ['pr', 'headSha', 'patchId']

export const PROMPT =
  'Read .bauherr/context.json, .bauherr/SKILL.md and .bauherr/result.schema.json. ' +
  'Do the work of the stage as SKILL.md describes. ' +
  'Then write the result as JSON that matches result.schema.json to .bauherr/result.json. ' +
  'The Runner commits, pushes and adds the fields pr, headSha and patchId itself: leave them out.'

export const FIX_PROMPT =
  'Your result was refused. Read .bauherr/problems.json, correct .bauherr/result.json so that it matches ' +
  '.bauherr/result.schema.json, and change nothing else.'

const NO_SKILL = 'No skill text is installed for this stage: do what the record and the result schema ask for.'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const withoutFacts = (schema: unknown): unknown => {
  if (!isRecord(schema)) return schema
  const properties = isRecord(schema.properties) ? schema.properties : {}
  const required = Array.isArray(schema.required) ? schema.required : []
  return {
    ...schema,
    properties: Object.fromEntries(Object.entries(properties).filter(([name]) => !FACT_FIELDS.includes(name))),
    required: required.filter((name) => !FACT_FIELDS.includes(String(name))),
  }
}

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

export const writeContext = async (dir: string, pack: ContextPack): Promise<void> => {
  const folder = join(dir, WORK_DIR)
  await mkdir(folder, { recursive: true })
  const { skill, resultSchema, ...context } = pack
  await writeFile(join(folder, 'context.json'), json(context))
  await writeFile(join(folder, 'SKILL.md'), skill ?? NO_SKILL)
  await writeFile(join(folder, 'result.schema.json'), json(withoutFacts(resultSchema)))
}

export const writeProblems = (dir: string, problems: Problem[]): Promise<void> =>
  writeFile(join(dir, WORK_DIR, 'problems.json'), json(problems))

export const readResult = async (dir: string): Promise<Record<string, unknown> | null> => {
  const text = await readFile(join(dir, WORK_DIR, 'result.json'), 'utf8').catch(() => null)
  if (text === null) return null
  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}
