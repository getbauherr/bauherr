import type { Person } from './decide'
import type { Stage } from './events'
import type { Role } from './lifecycle'

export const MEMORY_STAGES = ['brief', 'build', 'review', 'verify'] as const
export const DOCUMENT_SCOPES = ['factory', 'workspace', 'product'] as const

export type MemoryStage = (typeof MEMORY_STAGES)[number]

export const STAGE_LABEL: Record<MemoryStage, string> = {
  brief: 'Brief',
  build: 'Build',
  review: 'Review',
  verify: 'Verify',
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

export type Who = { person: Person; workspace: number }
