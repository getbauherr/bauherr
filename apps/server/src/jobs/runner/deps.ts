import { mkdir } from 'node:fs/promises'
import { sql } from '@payloadcms/db-postgres'
import { execute } from '@bauherr/runner'
import type { Payload } from 'payload'
import { z } from 'zod'
import { readerFor } from '../../core/forge/reader'
import { createWriter } from '../../core/forge/writer'
import type { Role } from '../../core/lifecycle'
import { MODULES, skillFor } from '../../lean'
import { connectionInput, isGithubApp, webOrigin } from '../../lib/connection'
import { tierModels } from '../../lib/gateway'
import { decrypt } from '../../lib/secrets'
import { engineDeps } from '../engine-deps'
import type { AgentOutcome, AgentRequest, RepoAccess, RunnerDeps } from './types'

const TIERS: Record<Role, 'standard' | 'strong'> = { builder: 'standard', reviewer: 'strong', verifier: 'strong' }

export const MAX_TURNS = 80
export const MAX_BUDGET_USD = 5
export const TIMEOUT_MS = 25 * 60_000
export const BEAT_MS = 60_000
export const DEFAULT_MAX_RUNS = 2

export const maxRuns = (): number => {
  const raw = process.env.BAUHERR_MAX_RUNS
  const max = raw === undefined || raw === '' ? DEFAULT_MAX_RUNS : Number(raw)
  if (!Number.isInteger(max) || max < 1) throw new Error('BAUHERR_MAX_RUNS must be a positive integer')
  return max
}

const connectionRow = z.object({ connection_id: z.coerce.number(), source_repo: z.string() })
const workspaceDoc = z.object({ slug: z.string(), gatewayKey: z.string().nullish() })

const repoAccess = async (payload: Payload, recordId: number): Promise<RepoAccess> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT s."connection_id", r."source_repo" FROM "records" r
    JOIN "ticket_sources" s ON s."product_id" = r."product_id" AND s."repo" = r."source_repo"
    WHERE r."id" = ${recordId}`)
  const row = found.rows[0]
  if (!row) throw new Error(`Record ${recordId} has no ticket source: connect the repository first.`)
  const { connection_id: connectionId, source_repo: repo } = connectionRow.parse(row)
  const connection = await connectionInput(payload, connectionId)
  if (!connection.secret) throw new Error(`Connection ${connection.id} has no secret.`)
  if (isGithubApp(connection)) throw new Error('A GitHub App connection cannot clone yet: use a token connection.')
  const forgeRepo = await readerFor(connection).forge.getRepository(repo)
  const override = process.env.BAUHERR_GIT_BASE_URL
  return {
    baseUrl: override || (connection.kind === 'gitlab' ? webOrigin(connection) : 'https://github.com'),
    repo,
    defaultBranch: forgeRepo.defaultBranch,
    token: connection.secret,
    ...(connection.kind === 'gitlab' ? { user: 'oauth2' } : {}),
  }
}

const modelFor = async (payload: Payload, workspace: number, role: Role): Promise<string> => {
  const doc = await payload.findByID({ collection: 'workspaces', id: workspace, depth: 0, overrideAccess: true })
  const models = await tierModels(payload, doc)
  const model = models[TIERS[role]]
  if (!model) throw new Error(`Workspace ${workspace} has no model for the ${TIERS[role]} tier.`)
  return model
}

const onGateway = async (payload: Payload, request: AgentRequest): Promise<AgentOutcome> => {
  const gatewayUrl = process.env.GATEWAY_URL
  if (!gatewayUrl) return { ok: false, reason: 'GATEWAY_URL is not set' }
  const found = await payload.findByID({
    collection: 'workspaces',
    id: request.workspace,
    depth: 0,
    overrideAccess: true,
    showHiddenFields: true,
  })
  const workspace = workspaceDoc.parse(found)
  if (!workspace.gatewayKey) return { ok: false, reason: `Workspace ${workspace.slug} has no gateway key` }
  await mkdir(request.home, { recursive: true })
  return execute({
    runId: String(request.runId),
    stage: request.stage,
    model: request.model,
    cwd: request.cwd,
    home: request.home,
    prompt: request.prompt,
    readOnly: request.readOnly,
    ...(request.readOnly ? { writablePaths: ['.bauherr/'] } : {}),
    maxTurns: MAX_TURNS,
    maxBudgetUsd: MAX_BUDGET_USD,
    timeoutMs: TIMEOUT_MS,
    gatewayUrl,
    gatewayKey: decrypt(workspace.gatewayKey),
  })
}

export const runnerDeps = (payload: Payload): RunnerDeps => ({
  engine: () => ({ ...engineDeps(payload), modules: MODULES, skills: skillFor }),
  writer: createWriter(payload),
  access: (recordId) => repoAccess(payload, recordId),
  model: (workspace, role) => modelFor(payload, workspace, role),
  agent: (request) => onGateway(payload, request),
  beatMs: BEAT_MS,
})
