import { sql } from '@payloadcms/db-postgres'
import type { Forge } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { z } from 'zod'
import { ProductObserving } from '../forge/errors'
import { createWriter, defaultDeps, type ForgeWriter, type WriterDeps } from '../forge/writer'
import { loadFacts } from '../readiness/load'
import { forgeText } from './forge-text'
import type { AskModel } from './notes'
import { readNotes, UNRELEASED, writeNotesFor } from './notes-store'
import {
  abandon,
  claim,
  createRun,
  dropUnreleasedNotes,
  readRun,
  readRunIn,
  runByVersion,
  runningIds,
  saveRun,
  unclaim,
} from './run-store'
import { OPTIONS, type ReleaseRun, type RunOption, type Step, type StepId } from './run-steps'
import { readyToRelease, type ProductAt } from './ready'
import { validVersion } from './version'

export const DEPLOY_LIMIT_MINUTES = 30
const DEPLOY_LIMIT_MS = DEPLOY_LIMIT_MINUTES * 60_000

export class ReleaseRefused extends Error {}

export type ReleaseDeps = WriterDeps
type Reads = Pick<Forge, 'latestDeployment' | 'commitEndpoint' | 'getRepository'>
type Context = { payload: Payload; deps: ReleaseDeps; writer: ForgeWriter }

export type StartInput = ProductAt & { version: string; notesLink: string }

export const startRelease = async (ctx: Context, input: StartInput, ask: AskModel): Promise<ReleaseRun> => {
  const { payload, deps } = ctx
  const existing = await runByVersion(payload, input.product, input.version)
  if (existing && existing.state !== 'abandoned') return existing
  const ready = await readyToRelease(payload, input, deps.now())
  if (!ready) throw new ReleaseRefused('The repository has not been read yet.')
  if (ready.refusal) throw new ReleaseRefused(ready.refusal)
  if (!validVersion(input.version, ready.tags)) {
    throw new ReleaseRefused(`${input.version} is already used or is not a version number such as v1.2.3.`)
  }
  await writeNotesFor(payload, { ...input, version: UNRELEASED }, ready.merged, ask)
  const notes = await readNotes(payload, input.product, UNRELEASED)
  const body = forgeText(notes?.items ?? [], notes?.internal ?? 0, input.notesLink)
  return createRun(
    payload,
    { ...input, sha: ready.sha, body, tickets: ready.tickets },
    async (tx) => {
      const open = await tx.db.drizzle.execute(
        sql`SELECT 1 FROM "product_releases"
          WHERE "product_id" = ${input.product} AND "state" IN ('running', 'failed')`,
      )
      if (open.rows.length > 0) throw new ReleaseRefused('Another release of this product is not finished yet.')
    },
  )
}

type Place = { repo: string; kind: string; reads: Reads }

const placeOf = async (ctx: Context, run: ReleaseRun): Promise<Place> => {
  const found = await ctx.payload.db.drizzle.execute(sql`
    SELECT s."repo", s."connection_id", c."kind" FROM "ticket_sources" s
    JOIN "connections" c ON c."id" = s."connection_id"
    WHERE s."product_id" = ${run.product} AND s."workspace_id" = ${run.workspace} ORDER BY s."id" LIMIT 1`)
  const parsed = z
    .object({ repo: z.string(), connection_id: z.coerce.number(), kind: z.string() })
    .parse(found.rows[0])
  const backend = await ctx.deps.backend(parsed.connection_id)
  return { repo: parsed.repo, kind: parsed.kind, reads: backend.forge }
}

class StepFailed extends Error {}

type Outcome = { link?: string | null; detail?: string | null } | 'waiting'

const target = (run: ReleaseRun) => ({ workspace: run.workspace, product: run.product })

const pipelinesOf = (kind: string, repoUrl: string): string =>
  kind === 'gitlab' ? `${repoUrl}/-/pipelines` : `${repoUrl}/actions`

const issueItem = async (payload: Payload, run: ReleaseRun, repo: string, number: number): Promise<number | null> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT "id" FROM "mirror_items"
    WHERE "workspace_id" = ${run.workspace} AND "repo" = ${repo} AND "number" = ${number} AND "kind" = 'issue'`)
  return found.rows[0] ? z.coerce.number().parse(found.rows[0].id) : null
}

const tag = async (ctx: Context, run: ReleaseRun): Promise<Outcome> => {
  const { version, sha, body } = run
  const release = await ctx.writer.draftRelease(target(run), { tag: version, sha, name: version, body })
  if (release.sha !== sha) {
    throw new StepFailed(`${version} already exists on another commit than ${sha.slice(0, 7)}.`)
  }
  run.forgeRelease = release.id
  return { link: release.url }
}

const startProduction = async (ctx: Context, run: ReleaseRun): Promise<void> => {
  const loaded = await loadFacts(ctx.payload, { ...target(run), now: ctx.deps.now() })
  const facts = loaded?.facts.release
  if (!facts?.productionWorkflow || !facts.versionInput) {
    throw new StepFailed('The production workflow or its version input is not known. Read the repository again.')
  }
  const inputs = { [facts.versionInput]: run.version }
  await ctx.writer.startDeploy(target(run), { workflow: facts.productionWorkflow, ref: run.version, inputs })
}

const deploy = async (ctx: Context, run: ReleaseRun, place: Place, steps: Step[]): Promise<Outcome> => {
  const mine = steps.find((step) => step.id === 'deploy')
  const current = await place.reads.latestDeployment(place.repo, 'production')
  const seen = current !== null && current.sha === run.sha && current.state !== 'failure'
  if (!seen && !mine?.started) {
    await startProduction(ctx, run)
    if (mine) mine.started = true
    await persist(ctx, run, steps, 'running', null)
  }
  const url = (await place.reads.getRepository(place.repo)).url
  return { link: pipelinesOf(place.kind, url) }
}

const overdue = (ctx: Context, steps: Step[]): boolean => {
  const since = steps.find((step) => step.id === 'deploy')?.at
  return since !== null && since !== undefined && ctx.deps.now().getTime() - Date.parse(since) >= DEPLOY_LIMIT_MS
}

const wait = async (ctx: Context, run: ReleaseRun, place: Place, steps: Step[]): Promise<Outcome> => {
  const deployment = await place.reads.latestDeployment(place.repo, 'production')
  const ours = deployment?.sha === run.sha ? deployment : null
  if (ours?.state === 'failure') throw new StepFailed('The production deploy failed.')
  if (ours?.state === 'success') return { link: ours.url }
  if (overdue(ctx, steps)) {
    throw new StepFailed(`Production did not report ${run.sha.slice(0, 7)} within ${DEPLOY_LIMIT_MINUTES} minutes.`)
  }
  return 'waiting'
}

const check = async (run: ReleaseRun, place: Place): Promise<Outcome> => {
  const deployment = await place.reads.latestDeployment(place.repo, 'production')
  if (!deployment?.url) throw new StepFailed('Production reports no address to check.')
  const shows = await place.reads.commitEndpoint(place.repo, { url: deployment.url, sha: run.sha })
  if (!shows) throw new StepFailed(`Production does not show commit ${run.sha.slice(0, 7)}.`)
  return { link: deployment.url }
}

const publish = async (ctx: Context, run: ReleaseRun): Promise<Outcome> => {
  const release = await ctx.writer.publishRelease(target(run), run.forgeRelease ?? run.version, run.body)
  return { link: release.url }
}

const tell = async (ctx: Context, run: ReleaseRun, place: Place): Promise<Outcome> => {
  for (const ticket of run.tickets) {
    const itemId = await issueItem(ctx.payload, run, place.repo, ticket.number)
    if (itemId === null) continue
    const body = `Released in ${run.version}.`
    await ctx.writer.commentOnTicket({ recordId: ticket.recordId, itemId }, { key: `released-${run.version}`, body })
  }
  await dropUnreleasedNotes(ctx.payload, run.product)
  return { detail: `${run.tickets.length} tickets` }
}

const runStep = (ctx: Context, id: StepId, run: ReleaseRun, place: Place, steps: Step[]): Promise<Outcome> => {
  switch (id) {
    case 'tag':
      return tag(ctx, run)
    case 'deploy':
      return deploy(ctx, run, place, steps)
    case 'wait':
      return wait(ctx, run, place, steps)
    case 'check':
      return check(run, place)
    case 'publish':
      return publish(ctx, run)
    case 'tell':
      return tell(ctx, run, place)
  }
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const persist = (ctx: Context, run: ReleaseRun, steps: Step[], state: ReleaseRun['state'], failure: string | null) =>
  saveRun(ctx.payload, run.id, { steps, state, failure, forgeRelease: run.forgeRelease })

const advanceClaimed = async (ctx: Context, run: ReleaseRun): Promise<void> => {
  const place = await placeOf(ctx, run)
  const steps = run.steps.map((step) => ({ ...step }))
  for (const step of steps) {
    if (step.status === 'done') continue
    try {
      const outcome = await runStep(ctx, step.id, run, place, steps)
      if (outcome === 'waiting') return await persist(ctx, run, steps, 'running', null)
      Object.assign(step, { status: 'done', link: outcome.link ?? null, detail: outcome.detail ?? null })
      step.at = ctx.deps.now().toISOString()
      await persist(ctx, run, steps, 'running', null)
    } catch (error) {
      if (error instanceof ProductObserving) throw error
      Object.assign(step, { status: 'failed', detail: errorText(error) })
      return await persist(ctx, run, steps, 'failed', errorText(error))
    }
  }
  await persist(ctx, run, steps, 'done', null)
}

export const advanceRelease = async (ctx: Context, id: number): Promise<ReleaseRun | null> => {
  if (!(await claim(ctx.payload, id))) return readRun(ctx.payload, id)
  try {
    const run = await readRun(ctx.payload, id)
    if (run?.state === 'running') await advanceClaimed(ctx, run)
  } finally {
    await unclaim(ctx.payload, id)
  }
  return readRun(ctx.payload, id)
}

export const advanceRunning = async (ctx: Context): Promise<number> => {
  const ids = await runningIds(ctx.payload)
  for (const id of ids) await advanceRelease(ctx, id)
  return ids.length
}

export const answerRelease = async (ctx: Context, at: ProductAt, id: number, option: RunOption): Promise<void> => {
  const run = await readRunIn(ctx.payload, id, at)
  if (run?.state !== 'failed' || !OPTIONS.includes(option)) return
  if (option === 'release-fixed-later') return abandon(ctx.payload, id)
  const steps = run.steps.map((step) =>
    step.status === 'failed' ? { ...step, status: 'todo' as const, detail: null } : step,
  )
  await persist(ctx, run, steps, 'running', null)
  await advanceRelease(ctx, id)
}

export const createReleaser = (payload: Payload, deps: ReleaseDeps = defaultDeps(payload)) => {
  const ctx: Context = { payload, deps, writer: createWriter(payload, deps) }
  return {
    ready: (at: ProductAt) => readyToRelease(payload, at, deps.now()),
    start: async (input: StartInput, ask: AskModel) => {
      const run = await startRelease(ctx, input, ask)
      return advanceRelease(ctx, run.id)
    },
    advance: (id: number) => advanceRelease(ctx, id),
    advanceRunning: () => advanceRunning(ctx),
    answer: (at: ProductAt, id: number, option: RunOption) => answerRelease(ctx, at, id, option),
  }
}

export type Releaser = ReturnType<typeof createReleaser>
