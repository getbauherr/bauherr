import { resolve } from 'node:path'
import type { Payload } from 'payload'
import type { RunCtx } from '@bauherr/runner'
import { sql } from '@payloadcms/db-postgres'
import { presetOf } from './providers'
import { moveStage } from './stage-move'
import { advance } from './advance'
import { backendFor } from './adapters'
import { prOf } from './release'
import { fixBaseOf, reviewRoundOf } from './actions'
import { dequeueBeforeChange } from './merge-mode'
import { baseCaps, escalatedCaps, isEscalated, noteEscalatedBuild, scanCaps } from './investigation'
import { INVESTIGATION_MARKER } from '../app/(app)/lib/plan'
import { webOrigin, type ConnectionInput } from './connection'
import { tierModels } from './gateway'
import { forgeOf, id } from './release'
import { storePlanTldr } from './decision'
import { SKILL_TEMPLATES, forAgent, headingOf, template } from './templates'
import { read as readKnowledge } from './knowledge'
import { kindOfRun } from './stage-text'
import { docsContext } from './docs-check'
import { workflowFor } from './factory'
import { byKind, is, nameOf, roleOf, stage as stageOf } from './workflow'

export { tierModels }

export const DEFAULT_GOAL = { plan: 'a plan comment is posted', build: 'MR linked on the Ticket', review: 'the MR is reviewed and the verdict is recorded', triage: 'the Ticket has a triage outcome (plan, refine or skip)', agent: 'the stage outcome is reported', scan: 'the scan findings are recorded' }
/** Autonomous Runs open the MR after the agent turn, so their agent cannot verify "MR linked"; deviation from #99. */
const AUTONOMOUS_BUILD_GOAL = 'the change is implemented and the checks pass'
export type GoalStage = keyof typeof DEFAULT_GOAL
const WORKLOG_MARKER = '<!-- bauherr:worklog -->'
const PLAN_MARKER = '<!-- bauherr:plan -->'
const PACK_DIR = process.env.BAUHERR_PACK_DIR ?? resolve(process.cwd(), '../../pack')

/** Statements from a body's `## Acceptance criteria` bullets (or paragraph); empty when the section is missing. */
const acceptance = (body: string): string[] => {
  const section = /^##\s+Acceptance criteria\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/im.exec(body)?.[1] ?? ''
  const items = [...section.matchAll(/^\s*(?:[-*]|\d+\.)\s+(?:\[.\]\s+)?(.+)$/gm)].map((m) => m[1]!.trim())
  const text = section.trim()
  return items.length ? items : text ? [text] : []
}

/** Own acceptance criteria, else the parent's, else the stage default. */
export const goalOf = (body: string, stage: GoalStage = 'plan', parentBody = ''): string[] => {
  const found = acceptance(body)
  const inherited = found.length ? found : acceptance(parentBody)
  return inherited.length ? inherited : [DEFAULT_GOAL[stage]]
}

type Doc = Record<string, any>

/** `goalOf` for a Ticket row; loads the parent Ticket's body only when this one has no criteria, same Workspace only. Any failure falls back to the stage default. */
export const goalFor = async (payload: Payload, ticket: Doc, body: string, stage: GoalStage): Promise<string[]> => {
  if (acceptance(body).length || !ticket.parent) return goalOf(body, stage)
  try {
    const parent = (await payload.findByID({ collection: 'tickets', id: typeof ticket.parent === 'object' ? ticket.parent.id : ticket.parent, depth: 0, overrideAccess: true })) as Doc
    if (String(id(parent.workspace)) !== String(id(ticket.workspace))) return goalOf(body, stage)
    return goalOf(body, stage, (await (await forgeOf(payload, id(parent.product))).tickets.get(String(parent.number))).body)
  } catch {
    return goalOf(body, stage)
  }
}

/** What the Runner's git commands need to reach the forge. */
export const gitAccess = (github: ConnectionInput) => {
  const gitBaseUrl = process.env.BAUHERR_GIT_BASE_URL || (github.kind === 'gitlab' ? webOrigin(github) : undefined)
  return { gitToken: github.secret!, ...(gitBaseUrl && { gitBaseUrl }), ...(github.kind === 'gitlab' && { gitUser: 'oauth2' }) }
}

/** The provider preset behind a gateway model id (`ws-<workspace>/<connection>/<model>`); null when no Connection of the Workspace has that slug. */
export const providerOf = async (payload: Payload, workspace: number | string, model: string | undefined): Promise<string | null> => {
  const slug = model?.split('/')[1]
  if (!slug) return null
  const conn = (await payload.find({ collection: 'connections', where: { workspace: { equals: workspace }, kind: { equals: 'llm-provider' }, slug: { equals: slug } }, limit: 1, depth: 0, overrideAccess: true })).docs[0] as Doc | undefined
  return conn ? presetOf(conn.config) : null
}

/** Builds the runner's RunCtx; tool calls attach to the latest persisted Step. */
export const buildRunCtx = async (
  payload: Payload,
  d: { run: Doc; ticket: Doc; repo: string; github: ConnectionInput; gatewayKey: string; defaultBranch?: string },
): Promise<RunCtx> => {
  const { run, ticket, repo } = d
  const wf = workflowFor(run.workspace)
  const kind = kindOfRun(wf, run)
  const opts = { overrideAccess: true } as const
  const workspace = typeof run.workspace === 'object' ? run.workspace.id : run.workspace
  const backend = backendFor(d.github)
  const tickets = backend.tickets(repo)
  const issue = await tickets.get(String(ticket.number))
  const goal = await goalFor(payload, ticket, issue.body, kind as GoalStage)
  const statements = goal.length === 1 && goal[0] === DEFAULT_GOAL.build ? [AUTONOMOUS_BUILD_GOAL] : goal
  const comments = await tickets.listComments(String(ticket.number))
  const lastWith = (marker: string) => comments.findLast((c) => c.body.startsWith(marker))
  let seq = 0
  let lastStep: number | string | undefined
  let lastModel = ''
  const gatewayUrl = process.env.GATEWAY_URL
  if (!gatewayUrl) throw new Error('GATEWAY_URL is not set')
  const ws = await payload.findByID({ collection: 'workspaces', id: workspace, depth: 0, ...opts })
  const modelByTier = await tierModels(payload, ws)
  const mr = kind === 'plan' || kind === 'triage' || kind === 'scan' || kind === 'docs' ? null : await prOf(payload, ticket)
  const existingPr = mr?.pr.state === 'open' ? { number: mr.pr.number, url: mr.pr.url, branch: mr.pr.head, title: mr.pr.title, body: mr.pr.body } : undefined
  // A Build Run pushes to this MR: a queued entry must be taken out first, a push would invalidate it.
  if (kind === 'build' && mr?.pr.state === 'open' && ticket.reviewState === 'queued') await dequeueBeforeChange(payload, ticket, mr)
  if (kind === 'review' && !existingPr) throw new Error('the Ticket has no open factory MR to review')
  const productDoc = (await payload.findByID({ collection: 'products', id: id(ticket.product), depth: 0, ...opts })) as Doc
  const base = kind === 'scan' ? scanCaps(productDoc) : baseCaps(kind)
  const escalated = await isEscalated(payload, run)
  const caps = escalated ? escalatedCaps(kind, base) : base
  if (escalated && kind === 'build') await noteEscalatedBuild(payload, run, caps)
  const role = roleOf(wf, run.stage)
  const def = stageOf(wf, run.stage)
  const roleModel = !escalated && role?.provider && role.model ? `ws-${ws.slug}/${role.provider}/${role.model}` : undefined
  const tier = escalated ? 'strong' : role?.tier ?? (kind === 'review' || kind === 'scan' || kind === 'docs' ? 'standard' : 'cheap')
  const fixBase = kind === 'review' ? await fixBaseOf(payload, ticket) : null
  const repoInfo = d.defaultBranch ? { defaultBranch: d.defaultBranch } : await backend.forge.getRepository(repo)

  return {
    stageNames: { review: byKind(wf, 'review')?.name },
    templates: Object.fromEntries(await Promise.all(Object.entries(SKILL_TEMPLATES).filter(([skill]) => skill !== 'intake').map(async ([skill, names]) => [skill, await Promise.all(names.map(async (n) => { const t = await template(payload, workspace, n); return { title: t.title, body: forAgent(t.body) } }))] as const))),
    run: { id: String(run.id), stage: run.stage, kind: kind as RunCtx['run']['kind'], goal: { statements }, ...caps, tier, ...(roleModel && { model: roleModel }) },
    ...(kind === 'agent' && def?.skill && { agent: { stage: def.name, title: def.title, skill: def.skill, roleProfile: role?.profile ?? '', outcomes: def.outcomeOrder ?? Object.keys(def.outcomes) } }),
    ticket: { id: String(ticket.id), number: ticket.number, url: ticket.url, title: ticket.title, body: issue.body,
      ...(lastWith(WORKLOG_MARKER) ? { worklog: lastWith(WORKLOG_MARKER)!.body } : {}),
      ...((kind !== 'plan' || run.investigation) && lastWith(PLAN_MARKER) ? { plan: lastWith(PLAN_MARKER)!.body } : {}),
      ...(run.investigation ? { investigation: lastWith(INVESTIGATION_MARKER)?.body ?? `${INVESTIGATION_MARKER}\nFailed ${run.investigation.stage} Runs: ${(run.investigation.failedRuns as number[]).map((r) => `#${r}`).join(', ')} (see their Run pages).` } : {}) },
    ...(existingPr && { existingPr }),
    ...(kind === 'review' && ticket.conflictReturnBase && { conflictBase: ticket.conflictReturnBase }),
    ...(kind === 'review' && { reviewRound: reviewRoundOf(ticket), ...(fixBase && { fixBase }) }),
    ...(kind === 'build' && existingPr && ticket.conflictReturnBase && { mergeBase: true }),
    product: { id: String(id(ticket.product)), repo, defaultBranch: repoInfo.defaultBranch, reviewChecks: productDoc.reviewChecks,
      ...(kind === 'docs' && { docs: await docsContext(payload, productDoc) }),
      ...(kind === 'scan' && { securityContext: (await readKnowledge(payload, workspace, 'SECURITY-CONTEXT.md', productDoc.slug))?.text }) },
    connection: {
      gatewayUrl,
      gatewayKey: d.gatewayKey,
      modelByTier,
      ...gitAccess(d.github),
    },
    forge: {
      openPullRequest: async (p) => backend.forge.openPullRequest(p.repo, p),
      comment: async (number, body) => {
        await tickets.comment(String(number), body)
        if (body.startsWith(PLAN_MARKER)) await storePlanTldr(payload, ticket.id, body, headingOf(await template(payload, workspace, 'plan'), 'tldr'))
      },
      upsertWorklog: async (number, body) => {
        const existing = lastWith(WORKLOG_MARKER)
        await (existing ? tickets.updateComment(String(number), existing.id, body) : tickets.comment(String(number), body))
      },
      setStage: async (number, stage) => {
        if (!is(wf, stage, 'review')) return moveStage(payload, tickets, { product: ticket.product, number }, stage, 'runner')
        await advance(payload, tickets, { ...ticket, stage: nameOf(wf, 'build') }, 'done', { by: 'factory', why: 'runner' })
      },
    },
    recorder: {
      step: async (s) => {
        if (lastStep !== undefined) await payload.db.drizzle.execute(sql`UPDATE "steps" SET "finished_at" = now() WHERE "id" = ${lastStep}`)
        const row = await payload.create({
          collection: 'steps',
          data: { run: run.id, workspace, messageId: s.messageId, tokensIn: s.inputTokens, tokensOut: s.outputTokens, seq: ++seq },
          ...opts,
        })
        lastStep = row.id
        // The model the Run actually used: the last non-empty one the agent reported.
        if (s.model && s.model !== lastModel) await payload.update({ collection: 'runs', id: run.id, data: { model: (lastModel = s.model) }, ...opts })
      },
      toolCall: async (t) => {
        const step = lastStep
        if (step === undefined) return
        await payload.create({
          collection: 'tool_calls',
          data: {
            workspace, step, toolUseId: t.toolUseId, name: t.tool,
            inputDigest: JSON.stringify(t.input).slice(0, 500), status: t.ok ? 'ok' : 'error', durationMs: t.durationMs,
          },
          ...opts,
        })
      },
      log: (msg) => payload.logger.info({ run: run.id }, msg),
    },
    packDir: PACK_DIR,
  }
}
