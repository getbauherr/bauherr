/** Local stubs of the contracts of packages/runner and packages/adapters (other lanes). */

export interface TicketSummary {
  externalId: string
  number: number
  url: string
  title: string
  state: 'open' | 'closed'
  labels: string[]
  assignee: string | null
  /** ISO timestamp at the Ticket source. */
  updatedAt: string
}

export interface PollResult {
  changes: TicketSummary[]
  next: string | null
}

export interface ConnectionInput {
  id: number | string
  kind: 'github' | 'gateway'
  config: Record<string, unknown>
  /** Decrypted secret; only ever passed in memory. */
  secret: string | null
  capabilities: Record<string, boolean>
}

export interface Adapters {
  github(connection: ConnectionInput): {
    tickets(repoFullName: string): { poll(cursor: string | null): Promise<PollResult> }
  }
}

export interface Recorder {
  step(data: {
    seq: number
    messageId?: string
    tokensIn?: number
    tokensOut?: number
    costEstimateUsd?: number
    startedAt?: string
  }): Promise<{ id: number | string }>
  toolCall(data: {
    step: number | string
    toolUseId: string
    name: string
    inputDigest?: string
    status?: 'ok' | 'error'
    durationMs?: number
  }): Promise<void>
  log(msg: string): void
}

export interface RunStageContext {
  run: Record<string, any>
  ticket: Record<string, any>
  product: Record<string, any>
  connection: ConnectionInput
  recorder: Recorder
}

export interface RunStageResult {
  status: 'succeeded' | 'failed' | 'cancelled' | 'needs_human'
  artifacts: Record<string, unknown>
}

export interface Runner {
  runStage(ctx: RunStageContext): Promise<RunStageResult>
}
