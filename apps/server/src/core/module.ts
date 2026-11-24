import type { CloseReason } from '@bauherr/adapters'
import type { z } from 'zod'
import type { AppEvent, Stage } from './events'
import type { Conn } from './conn'
import type { State } from './fold'
import type { Config, Role } from './lifecycle'
import type { RecordField, TicketRecord } from './record/schema'
import type { Run } from './run/schema'

export type Problem = { path: string; message: string }
export type Effect =
  | { kind: 'question'; body: string }
  | { kind: 'close'; reason: CloseReason }
  | { kind: 'reopen' }
  | { kind: 'status' }
  | { kind: 'review'; pr: number; body: string }
export type ApplyContext = { config: Config; state: State }
export type Applied = {
  patch: Partial<TicketRecord>
  events: AppEvent[]
  effects?: Effect[]
}

export type ModuleDefinition<Result> = {
  stage: Stage
  role: Role
  writes: RecordField[]
  resultSchema: z.ZodType<Result>
  gated?: boolean
  check?: (tx: Conn, run: Run, result: Result) => Promise<Problem[]>
  apply: (record: TicketRecord, result: Result, run: Run, context: ApplyContext) => Applied
}

export type LifecycleModule = {
  stage: Stage
  role: Role
  writes: RecordField[]
  resultSchema: z.ZodType
  gated?: boolean
  check?: (tx: Conn, run: Run, result: unknown) => Promise<Problem[]>
  apply: (record: TicketRecord, result: unknown, run: Run, context: ApplyContext) => Applied
}

export type ModuleKey = Stage | 'review'
export type Modules = Partial<Record<ModuleKey, LifecycleModule>>

export const moduleKey = (stage: Stage, role: Role): ModuleKey => {
  return role === 'reviewer' ? 'review' : stage
}

export const defineModule = <Result>(definition: ModuleDefinition<Result>): LifecycleModule => {
  const { check, ...rest } = definition
  return {
    ...rest,
    ...(check ? { check: (tx, run, result) => check(tx, run, definition.resultSchema.parse(result)) } : {}),
    apply: (record, result, run, context) =>
      definition.apply(record, definition.resultSchema.parse(result), run, context),
  }
}
