import { z } from 'zod'
import { isWebUrl } from './url'

export const EXECUTORS = ['session', 'runner'] as const
export const RELEASE_MODES = ['factory', 'direct'] as const

export const DAYS = { min: 1, max: 90 } as const
export const LIMIT = { min: 1, max: 50 } as const
export const DEPLOY_MINUTES = { min: 5, max: 1440 } as const

type FieldIssue = { path: string; message: string }

export class SectionError extends Error {
  readonly data: { errors: FieldIssue[] }

  constructor(errors: FieldIssue[]) {
    super('Settings invalid.')
    this.data = { errors }
  }
}

export const namesIn = (text: string): string[] => [
  ...new Set(
    text
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name !== ''),
  ),
]

const whole = (min: number, max: number) => {
  const message = `Enter a whole number from ${min} to ${max}.`
  const bounded = z.number().min(min, message).max(max, message)
  return z.string().trim().regex(/^\d+$/, message).transform(Number).pipe(bounded)
}

const checkNames = z
  .string()
  .transform(namesIn)
  .refine((names) => names.every((name) => name.length <= 100), 'A check name is at most 100 characters.')

const labelNames = z
  .string()
  .transform(namesIn)
  .refine((names) => names.every((name) => name.length <= 100), 'A label is at most 100 characters.')

const intakeSchema = z.object({
  excludedLabels: labelNames,
  outsideIssuesPerDay: whole(LIMIT.min, LIMIT.max),
  reporterRemindDays: whole(DAYS.min, DAYS.max),
  reporterSilentDays: whole(DAYS.min, DAYS.max),
})

const proofSchema = z.object({
  requiredChecks: checkNames,
  deployChecks: checkNames,
  deployWaitMinutes: whole(DEPLOY_MINUTES.min, DEPLOY_MINUTES.max),
  stagingUrl: z
    .string()
    .trim()
    .refine((url) => url === '' || isWebUrl(url), 'Enter an address starting with https://.'),
})

const executorSchema = z.object({ executor: z.enum(EXECUTORS, { error: 'Choose a session or the Runner.' }) })

const releaseModeSchema = z.object({
  releaseMode: z.enum(RELEASE_MODES, { error: 'Choose how releases happen.' }),
})

export const PERCENT = { min: 0, max: 100 } as const

const gatesSchema = z.object({
  backlogBriefLimit: whole(LIMIT.min, LIMIT.max),
  autoAcceptMaxSendBack: whole(PERCENT.min, PERCENT.max),
})

const textOf = (fd: FormData, key: string): string => {
  const value = fd.get(key)
  return typeof value === 'string' ? value : ''
}

const valuesOf = (fd: FormData, keys: readonly string[]): Record<string, string> =>
  Object.fromEntries(keys.map((key) => [key, textOf(fd, key)]))

const parse = <T extends z.ZodType>(schema: T, input: Record<string, string>): z.output<T> => {
  const result = schema.safeParse(input)
  if (result.success) return result.data
  const errors = result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
  throw new SectionError(errors)
}

export const parseExecutor = (fd: FormData) => parse(executorSchema, valuesOf(fd, ['executor']))

export const parseReleaseMode = (fd: FormData) => parse(releaseModeSchema, valuesOf(fd, ['releaseMode']))

export const parseIntake = (fd: FormData) => {
  const values = parse(intakeSchema, valuesOf(fd, Object.keys(intakeSchema.shape)))
  if (values.reporterSilentDays <= values.reporterRemindDays) {
    const message = 'Silence counts after the reminder: use more days.'
    throw new SectionError([{ path: 'reporterSilentDays', message }])
  }
  return { ...values, autoClose: fd.get('autoClose') === 'on' }
}

export const parseProof = (fd: FormData) => parse(proofSchema, valuesOf(fd, Object.keys(proofSchema.shape)))

export const parseGates = (fd: FormData, pathSets: Record<string, string[]>) => {
  const limits = parse(gatesSchema, valuesOf(fd, Object.keys(gatesSchema.shape)))
  const chosen = fd.getAll('riskAreas').filter((name) => typeof name === 'string')
  const unknown = chosen.filter((name) => !(name in pathSets))
  if (unknown.length) {
    throw new SectionError([{ path: 'riskAreas', message: `${unknown.join(', ')} is not one of the path sets.` }])
  }
  return { ...limits, autoAccept: fd.get('autoAccept') === 'on', riskAreas: [...new Set(chosen)] }
}
