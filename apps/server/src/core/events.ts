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

export const WRITE_KINDS = [
  'stage-label',
  'status-comment',
  'question',
  'merge',
  'close',
  'pull-request',
  'review',
  'reopen',
  'relation-add',
  'relation-remove',
] as const
const target = z.object({ repo: id, number: z.number().int().positive() })
const write = { kind: z.enum(WRITE_KINDS), target }

export const deferredSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('question'), target, body: id }),
  z.object({ kind: z.literal('close'), target, reason: z.enum(['completed', 'not_planned', 'duplicate']) }),
  z.object({ kind: z.literal('review'), target, body: id }),
])
export type Deferred = z.infer<typeof deferredSchema>

const eventSchema = z.discriminatedUnion('type', [
  event('intake.accepted', none),
  event('intake.asked', z.object({ round: z.number().int().positive() })),
  event('reporter.replied', none),
  event('reporter.reminded', none),
  event('reporter.silent', none),
  event('intake.closed', z.object({ reason: z.enum(['duplicate', 'not-planned', 'not-a-bug']) })),
  event('intake.disputed', none),
  event('run.started', z.object({ ...run, fingerprint: id })),
  event('run.failed', z.object({ ...run, reason: id })),
  event('run.released', z.object(run)),
  event('run.expired', z.object({ ...run, reason: id })),
  event('brief.submitted', z.object({ runId: id })),
  event('brief.approved', z.object({ by: z.enum(['owner', 'rule']) })),
  event('brief.changes-requested', z.object({ note: id })),
  event('brief.discarded', none),
  event('build.submitted', z.object({ runId: id, patchId: id, headSha: id, pr: z.number().int().positive() })),
  event('build.already-done', z.object({ runId: id, by: id, evidence: id })),
  event('ticket.done-elsewhere', none),
  event('pull.adopted', z.object({ pr: z.number().int().positive(), headSha: id, patchId: id })),
  event('pull.conflicted', z.object({ patchId: id, base: id })),
  event('checks.finished', z.object({ patchId: id, passed: z.boolean() })),
  event('review.submitted', z.object({ runId: id, patchId: id, headSha: id, findings: z.number().int().min(0) })),
  event('verify.passed', z.object({ runId: id, patchId: id, headSha: id })),
  event('verify.changes', z.object({ runId: id, patchId: id })),
  event('ship.merged', z.object({ sha: id })),
  event('ship.deployed', none),
  event('ship.deploy-stalled', z.object({ reason: z.enum(['failed', 'overdue']), checks: z.array(id) })),
  event('result.accepted', none),
  event('result.sent-back', z.object({ note: id })),
  event('production.approved', none),
  event('production.held', none),
  event('owner.note', z.object({ note: id })),
  event('ticket.closed', z.object({ reason: z.enum(['discarded', 'closed-on-forge', 'archived']) })),
  event('ticket.restored', none),
  event('ticket.blocked', z.object({ reason: z.string().min(1).nullable() })),
  event('verify.overridden', z.object({ patchId: id, headSha: id })),
  event(
    'question.asked',
    z.object({ reason: id, options: z.array(id).min(2).max(4), text: z.string().trim().min(1).max(200).optional() }),
  ),
  event('question.answered', z.object({ option: id })),
  event('forge.write.started', z.object(write)),
  event('forge.write.done', z.object(write)),
  event('forge.write.failed', z.object({ ...write, reason: id })),
  event('forge.write.deferred', deferredSchema),
])

export type AppEvent = z.infer<typeof eventSchema>
export type EventType = AppEvent['type']
export type EventOf<T extends EventType> = Extract<AppEvent, { type: T }>

export const parseEvent = (stored: { type: string; data: unknown }): AppEvent =>
  eventSchema.parse({ type: stored.type, data: stored.data })
