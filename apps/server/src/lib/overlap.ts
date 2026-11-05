import type { Forge } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { PLAN_MARKER, latestWith, planFiles } from '../app/(app)/lib/plan'
import { executionOrder } from './frontier'
import { isExpediting } from './expedite'
import { forgeOf, id, prOf } from './release'

type Doc = Record<string, any>
const o = { overrideAccess: true, depth: 0 } as const

const WILD = /[*?]/
const matches = (glob: string, path: string): boolean =>
  new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/|\*\*|\*|\?/g, (m) => ({ '**/': '(?:.*/)?', '**': '.*', '*': '[^/]*', '?': '[^/]' })[m]!)}$`).test(path)

/** True when two paths or globs can name a common file: equal paths, a glob matching a path, or two globs sharing a literal prefix up to their first wildcard (conservative). */
export const globsIntersect = (a: string, b: string): boolean => {
  const [wa, wb] = [WILD.test(a), WILD.test(b)]
  if (!wa && !wb) return a === b
  if (!wb) return matches(a, b)
  if (!wa) return matches(b, a)
  const [pa, pb] = [a.slice(0, a.search(WILD)), b.slice(0, b.search(WILD))]
  return pa.startsWith(pb) || pb.startsWith(pa)
}

/** The Ticket's actual PR files when it has a PR, else the `## Files` of its latest plan, else nothing; without the Product's `overlapIgnore` paths. */
export const ticketPaths = async (payload: Payload, t: Doc, ignore: string[]): Promise<string[]> => {
  let paths: string[] = []
  try {
    const pr = await prOf(payload, t)
    if (pr) paths = (await pr.backend.forge.listPullRequestFiles(pr.repo, pr.pr.number)).map((f: { filename: string }) => f.filename)
    else {
      const { tickets } = await forgeOf(payload, id(t.product))
      const plan = latestWith(await tickets.listComments(String(t.number)), PLAN_MARKER)
      paths = plan ? planFiles(plan.body) : []
    }
  } catch (e) {
    payload.logger.warn({ err: e, ticket: t.id }, 'overlap: paths unavailable, holding nothing')
  }
  return paths.filter((p) => !ignore.some((g) => g === p || matches(g, p)))
}

const LIVE_RUN = ['queued', 'awaiting_session', 'running']
const HUMAN_WAIT = ['needs_human', 'failed', 'cancelled']
const isBug = (t: Doc) => ((t.labels ?? []) as string[]).some((l) => l === 'type:bug' || l === 'urgent')

/** What an earlier Ticket has in flight, or null when it holds nothing: a live Run, or an open MR; a Ticket that waits on a human (its latest Run needs_human, failed or cancelled) holds nothing. `started`: a Run is running or an MR is open, not just queued. */
const inFlight = async (payload: Payload, e: Doc): Promise<{ started: boolean } | null> => {
  const runs = (await payload.find({ collection: 'runs', where: { ticket: { equals: e.id } }, sort: '-createdAt', limit: 50, ...o })).docs as Doc[]
  const live = runs.filter((r) => LIVE_RUN.includes(r.status))
  if (!live.length && runs[0] && HUMAN_WAIT.includes(runs[0].status)) return null
  const pr = await prOf(payload, e).catch(() => null)
  if (!live.length && !pr) return null
  return { started: !!pr || live.some((r) => r.status === 'running') }
}

/** The first open Ticket of `t`'s Product in Build or Review that comes before `t` as a Build, has work in flight and shares a path with it; null when none. A bug goes before a feature that has not started: that feature does not hold it, and a feature is held by any bug in flight, whatever its rank. */
export const overlappingTicket = async (payload: Payload, t: Doc): Promise<Doc | null> => {
  const product = (await payload.findByID({ collection: 'products', id: id(t.product), select: { overlapIgnore: true }, ...o })) as Doc
  const ignore = (product.overlapIgnore ?? []) as string[]
  const mine = await ticketPaths(payload, t, ignore)
  if (!mine.length) return null
  const me = { id: t.id, number: t.number, rank: t.rank, stage: 'build' }
  const earlier = ((await payload.find({ collection: 'tickets', where: { and: [{ product: { equals: id(t.product) } }, { state: { equals: 'open' } }, { stage: { in: ['build', 'review'] } }, { id: { not_equals: t.id } }] }, pagination: false, ...o })).docs as Doc[])
    .filter((e) => e.expedite || executionOrder(e as never, me) < 0 || (!isBug(t) && isBug(e)))
    .sort((a, b) => executionOrder(a as never, b as never))
  for (const e of earlier) {
    const flight = await inFlight(payload, e)
    if (!flight || (isBug(t) && !isBug(e) && !flight.started)) continue
    const theirs = await ticketPaths(payload, e, ignore)
    if (mine.some((m) => theirs.some((p) => globsIntersect(m, p)))) return e
  }
  return null
}

/** The Build hold (never for an expedite Ticket, which holds later overlapping Tickets instead): when an earlier Ticket overlaps, marks `t` as waiting for Build with "overlaps #N" and returns true; else false (the caller clears the mark on entry). */
export const holdOverlap = async (payload: Payload, t: Doc): Promise<boolean> => {
  if (await isExpediting(payload, t)) return false
  const other = await overlappingTicket(payload, t)
  if (!other) return false
  const waitingReason = `overlaps #${other.number}`
  if (t.waitingFor !== 'build' || t.waitingReason !== waitingReason) await payload.update({ collection: 'tickets', id: t.id, data: { waitingFor: 'build', waitingReason }, ...o })
  return true
}

/** Files changed in at least `share` of the last 100 merged PRs, most frequent first, as `{ path, percent }`. */
export const suggestOverlapIgnore = async (forge: Forge, repo: string, share = 0.25): Promise<{ path: string; percent: number }[]> => {
  const prs = await forge.listMergedPullRequests(repo, 100)
  if (!prs.length) return []
  const counts = new Map<string, number>()
  for (let i = 0; i < prs.length; i += 10) {
    for (const files of await Promise.all(prs.slice(i, i + 10).map((p) => forge.listPullRequestFiles(repo, p.number)))) {
      for (const f of new Set(files.map((x) => x.filename))) counts.set(f, (counts.get(f) ?? 0) + 1)
    }
  }
  return [...counts]
    .filter(([, n]) => n / prs.length >= share)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([path, n]) => ({ path, percent: Math.round((n / prs.length) * 100) }))
}
