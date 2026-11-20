import type { CloseReason } from '@bauherr/adapters'
import type { z } from 'zod'
import type { AppEvent, Stage } from './events'
import type { Role } from './lifecycle'
import type { RecordField, TicketRecord } from './record/schema'
import type { Run } from './run/schema'

export type Problem = { path: string; message: string }
export type Effect =
  | { kind: 'question'; body: string }
  | { kind: 'close'; reason: CloseReason }
  | { kind: 'status' }
export type Applied = { patch: Partial<TicketRecord>; events: AppEvent[]; effects?: Effect[] }

export type ModuleDefinition<Result> = {
  stage: Stage
  role: Role
  writes: RecordField[]
  resultSchema: z.ZodType<Result>
  gated?: boolean
  apply: (record: TicketRecord, result: Result, run: Run) => Applied
}

export type LifecycleModule = {
  stage: Stage
  role: Role
  writes: RecordField[]
  resultSchema: z.ZodType
  gated?: boolean
  apply: (record: TicketRecord, result: unknown, run: Run) => Applied
}

export type Modules = Partial<Record<Stage, LifecycleModule>>

export const defineModule = <Result>(definition: ModuleDefinition<Result>): LifecycleModule => ({
  ...definition,
  apply: (record, result, run) => definition.apply(record, definition.resultSchema.parse(result), run),
})
