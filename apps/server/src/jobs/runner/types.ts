import type { ForgeWriter } from '../../core/forge/writer'
import type { Role } from '../../core/lifecycle'
import type { SubmitDeps } from '../../core/submit'

export type RepoAccess = {
  baseUrl: string
  repo: string
  defaultBranch: string
  token: () => Promise<string>
  user?: string
}

export type AgentRequest = {
  runId: number
  stage: string
  workspace: number
  model: string
  cwd: string
  home: string
  prompt: string
  readOnly: boolean
}

export type AgentOutcome = { ok: true; costUsd: number } | { ok: false; reason: string }

export type RunnerDeps = {
  engine: () => SubmitDeps
  writer: Pick<ForgeWriter, 'openPullRequest'>
  access: (recordId: number) => Promise<RepoAccess>
  model: (workspace: number, role: Role) => Promise<string>
  agent: (request: AgentRequest) => Promise<AgentOutcome>
  beatMs: number
}

export type Ended = 'accepted' | 'failed' | 'released'
