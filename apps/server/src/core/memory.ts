import { z } from 'zod'
import type { Person } from './decide'
import type { Stage } from './events'
import type { Role } from './lifecycle'

export const MEMORY_MAX = 300
export const ALWAYS_MAX = 10
export const MEMORY_STAGES = ['brief', 'build', 'review', 'verify'] as const
export const REACHES = ['always', 'area', 'fit', 'ticket'] as const
export const APPLIES = ['fit', 'always', 'area'] as const
export const DOCUMENT_SCOPES = ['factory', 'workspace', 'product'] as const
export const WHY = ['always', 'area', 'fit'] as const

export type MemoryStage = (typeof MEMORY_STAGES)[number]
export type Reach = (typeof REACHES)[number]
export type Applies = (typeof APPLIES)[number]
export type Why = (typeof WHY)[number]

export const STAGE_LABEL: Record<MemoryStage, string> = {
  brief: 'Brief',
  build: 'Build',
  review: 'Review',
  verify: 'Verify',
}

export const REACH_LABEL: Record<Reach, string> = {
  always: 'Every ticket',
  area: 'An area of the code',
  fit: 'Tickets that fit',
  ticket: 'This ticket only',
}

export const runStageOf = (stage: Stage, role: Role): MemoryStage | null => {
  if (stage === 'verify' && role === 'reviewer') return 'review'
  return stage === 'brief' || stage === 'build' || stage === 'verify' ? stage : null
}

export class MemoryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}
export class MemoryNotFound extends MemoryError {}
export class MemoryInvalid extends MemoryError {}
export class NotAllowedToChangeMemory extends MemoryError {}

export const memoryInput = z.object({
  text: z.string().trim().min(1).max(MEMORY_MAX),
  reach: z.enum(REACHES),
  area: z.string().trim().min(1).optional(),
  stages: z.array(z.enum(MEMORY_STAGES)).min(1),
})

export type MemoryInput = z.infer<typeof memoryInput>
export type Who = { person: Person; workspace: number }
