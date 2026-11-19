import { z } from 'zod'

export const STAGES = ['intake', 'brief', 'build', 'verify', 'ship', 'done'] as const
export const ACTORS = ['owner', 'factory', 'agent', 'reporter'] as const

export const stageSchema = z.enum(STAGES)
export type Stage = z.infer<typeof stageSchema>
export type Actor = (typeof ACTORS)[number]

const id = z.string().trim().min(1)
const none = z.object({})
const run = { stage: stageSchema, runId: id }

const event = <T extends string, D extends z.ZodType>(type: T, data: D) =>
  z.object({ type: z.literal(type), data })

export const WRITE_KINDS = ['stage-label', 'status-comment', 'question', 'merge', 'close'] as const
const write = { kind: z.enum(WRITE_KINDS), target: z.object({ repo: id, number: z.number().int().positive() }) }

const eventSchema = z.discriminatedUnion('type', [
  event('intake.accepted', none),
  event('intake.asked', z.object({ round: z.number().int().positive() })),
  event('reporter.replied', none),
  event('reporter.silent', none),
  event('intake.closed', z.object({ reason: z.enum(['duplicate', 'not-planned', 'not-a-bug']) })),
  event('intake.disputed', none),
  event('run.started', z.object({ ...run, fingerprint: id })),
  event('run.failed', z.object({ ...run, reason: id })),
  event('run.released', z.object(run)),
  event('brief.submitted', z.object({ runId: id })),
  event('brief.approved', z.object({ by: z.enum(['owner', 'rule']) })),
  event('brief.changes-requested', z.object({ note: id })),
  event('brief.discarded', none),
  event('build.submitted', z.object({ runId: id, patchId: id, pr: z.number().int().positive() })),
  event('checks.finished', z.object({ patchId: id, passed: z.boolean() })),
  event('verify.passed', z.object({ runId: id, patchId: id })),
  event('verify.changes', z.object({ runId: id, patchId: id })),
  event('ship.merged', z.object({ sha: id })),
  event('ship.deployed', none),
  event('result.accepted', none),
  event('result.sent-back', z.object({ note: id })),
  event('production.approved', none),
  event('question.asked', z.object({ reason: id, options: z.array(id).min(2).max(4) })),
  event('question.answered', z.object({ option: id })),
  event('forge.write.started', z.object(write)),
  event('forge.write.done', z.object(write)),
  event('forge.write.failed', z.object({ ...write, reason: id })),
])

export type AppEvent = z.infer<typeof eventSchema>
export type EventType = AppEvent['type']
export type EventOf<T extends EventType> = Extract<AppEvent, { type: T }>

export const parseEvent = (stored: { type: string; data: unknown }): AppEvent =>
  eventSchema.parse({ type: stored.type, data: stored.data })
