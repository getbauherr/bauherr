import { resolve } from 'node:path'
import type { Payload } from 'payload'
import type { RunCtx } from '@bauherr/runner'
import { setStage } from '@bauherr/adapters'
import { githubFor } from './adapters'
import type { ConnectionInput } from './connection'
import { DEFAULT_MODEL_BY_TIER } from './gateway'

export const DEFAULT_GOAL = { plan: 'a plan comment is posted', build: 'the change described in the plan is implemented and the checks pass' }
const WORKLOG_MARKER = '<!-- bauherr:worklog -->'
const PLAN_MARKER = '<!-- bauherr:plan -->'
const PACK_DIR = process.env.BAUHERR_PACK_DIR ?? resolve(process.cwd(), '../../pack')

/** Statements from the Ticket's `## Acceptance criteria` bullets, else the default. */
export const goalOf = (body: string, stage: 'plan' | 'build' = 'plan'): string[] => {
  const section = /^##\s+Acceptance criteria\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/im.exec(body)?.[1] ?? ''
  const items = [...section.matchAll(/^\s*(?:[-*]|\d+\.)\s+(?:\[.\]\s+)?(.+)$/gm)].map((m) => m[1]!.trim())
  const text = section.trim()
  return items.length ? items : text ? [text] : [DEFAULT_GOAL[stage]]
}

type Doc = Record<string, any>

/** Builds the runner's RunCtx; tool calls attach to the latest persisted Step. */
export const buildRunCtx = async (
  payload: Payload,
  d: { run: Doc; ticket: Doc; repo: string; github: ConnectionInput; gatewayKey: string; defaultBranch?: string },
): Promise<RunCtx> => {
  const { run, ticket, repo } = d
  const opts = { overrideAccess: true } as const
  const workspace = typeof run.workspace === 'object' ? run.workspace.id : run.workspace
  const backend = githubFor(d.github)
  const tickets = backend.tickets(repo)
  const issue = await tickets.get(String(ticket.number))
  const statements = goalOf(issue.body, run.stage)
  const comments = await tickets.listComments(String(ticket.number))
  const lastWith = (marker: string) => comments.findLast((c) => c.body.startsWith(marker))
  let seq = 0
  let lastStep: number | string | undefined
  const gatewayUrl = process.env.GATEWAY_URL
  if (!gatewayUrl) throw new Error('GATEWAY_URL is not set')
  const ws = await payload.findByID({ collection: 'workspaces', id: workspace, depth: 0, ...opts })
  const tiers = { ...DEFAULT_MODEL_BY_TIER, ...(ws.modelByTier as Record<string, string> | null) }
  const modelByTier = Object.fromEntries(Object.entries(tiers).map(([t, m]) => [t, `ws-${ws.slug}/${m}`]))
  const repoInfo = d.defaultBranch ? { defaultBranch: d.defaultBranch } : await backend.forge.getRepository(repo)

  return {
    run: { id: String(run.id), stage: run.stage, goal: { statements }, maxTurns: 20, maxBudgetUsd: 0.5, tier: 'cheap' },
    ticket: { id: String(ticket.id), number: ticket.number, url: ticket.url, title: ticket.title, body: issue.body,
      ...(lastWith(WORKLOG_MARKER) ? { worklog: lastWith(WORKLOG_MARKER)!.body } : {}),
      ...(run.stage === 'build' && lastWith(PLAN_MARKER) ? { plan: lastWith(PLAN_MARKER)!.body } : {}) },
    product: { id: String(typeof ticket.product === 'object' ? ticket.product.id : ticket.product), repo, defaultBranch: repoInfo.defaultBranch },
    connection: {
      gatewayUrl,
      gatewayKey: d.gatewayKey,
      gitToken: d.github.secret!,
      modelByTier,
      ...(process.env.BAUHERR_GIT_BASE_URL ? { gitBaseUrl: process.env.BAUHERR_GIT_BASE_URL } : {}),
    },
    forge: {
      openPullRequest: async (p) => backend.forge.openPullRequest(p.repo, p),
      comment: async (number, body) => void (await tickets.comment(String(number), body)),
      upsertWorklog: async (number, body) => {
        const existing = lastWith(WORKLOG_MARKER)
        await (existing ? tickets.updateComment(String(number), existing.id, body) : tickets.comment(String(number), body))
      },
      setStage: (number, stage) => setStage(tickets, String(number), stage),
    },
    recorder: {
      step: async (s) => {
        const row = await payload.create({
          collection: 'steps',
          data: { run: run.id, workspace, messageId: s.messageId, tokensIn: s.inputTokens, tokensOut: s.outputTokens, seq: ++seq },
          ...opts,
        })
        lastStep = row.id
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
