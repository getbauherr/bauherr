import type { Check, PullRequest } from '@bauherr/adapters'
import type { Payload, Where } from 'payload'
import { inKindStage } from './stage-scope'
import { forgeOf, id, isFactoryPr, latestChecks, passed } from './release'

type Doc = Record<string, any>
const o = { depth: 0, overrideAccess: true } as const

export type CiRow = { name: string; status: string; conclusion: string | null; url?: string; startedAt?: string }
export type CiSummary = { total: number; passed: number; pending: number; failed: string[]; url: string | null; updatedAt: string; rows: CiRow[] }

/** The latest run of each check of an MR head as a stored summary; `url` is the MR's. */
export const summarize = (checks: Check[], url: string | null, now = new Date()): CiSummary => {
  const latest = latestChecks(checks)
  return {
    total: latest.length,
    passed: latest.filter(passed).length,
    pending: latest.filter((c) => c.status !== 'completed').length,
    failed: latest.filter((c) => c.status === 'completed' && !passed(c)).map((c) => c.name),
    url,
    updatedAt: now.toISOString(),
    rows: latest.map(({ name, status, conclusion, url: u, startedAt }) => ({ name, status, conclusion, ...(u && { url: u }), ...(startedAt && { startedAt }) })),
  }
}

/** The Ticket's stored summary and its age in ms; null without one. */
export const ciSummaryOf = (t: Doc, now = Date.now()): { summary: CiSummary; ageMs: number } | null => {
  const summary = t.ciSummary as CiSummary | null | undefined
  return summary ? { summary, ageMs: Math.max(0, now - Date.parse(summary.updatedAt)) } : null
}

/**
 * Stores `ciSummary` on every open Ticket in a build or review stage whose factory MR is open, and clears it on any other Ticket that still has one.
 * A forge error leaves that Ticket's summary as it was. Returns the number of summaries written.
 */
export const storeCiSummaries = async (payload: Payload, now = new Date()): Promise<number> => {
  const building = await inKindStage(payload, 'build')
  const reviewing = await inKindStage(payload, 'review')
  const live: Where = { and: [{ state: { equals: 'open' } }, { or: [building, reviewing] }] }
  const tickets = (await payload.find({ collection: 'tickets', where: live, pagination: false, ...o })).docs as Doc[]
  const ids = new Set(tickets.map((t) => t.id))
  const stale = (await payload.find({ collection: 'tickets', where: { ciSummary: { exists: true } }, select: {}, pagination: false, ...o })).docs.filter((t) => !ids.has(t.id))
  for (const t of stale) await payload.update({ collection: 'tickets', id: t.id, data: { ciSummary: null }, ...o })
  let stored = 0
  const forges = new Map<number | string, ReturnType<typeof forgeOf>>()
  const open = new Map<number | string, Promise<PullRequest[]>>()
  for (const t of tickets) {
    try {
      const pid = id(t.product)
      if (!forges.has(pid)) forges.set(pid, forgeOf(payload, pid))
      const { backend, repo } = await forges.get(pid)!
      if (!open.has(pid)) open.set(pid, backend.forge.listPullRequests(repo, 'open'))
      const pr = (await open.get(pid)!).filter((p) => p.state === 'open' && isFactoryPr(p, repo, t.number)).sort((a, b) => b.number - a.number)[0]
      if (!pr) {
        if (t.ciSummary) await payload.update({ collection: 'tickets', id: t.id, data: { ciSummary: null }, ...o })
        continue
      }
      const summary = summarize(await backend.forge.listChecks(repo, pr.headSha), pr.url, now)
      await payload.update({ collection: 'tickets', id: t.id, data: { ciSummary: summary }, ...o })
      stored++
    } catch (e) {
      payload.logger.warn({ err: e, ticket: t.id }, 'ci summary skipped')
    }
  }
  return stored
}
