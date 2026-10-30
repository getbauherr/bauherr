import { setStage, type Check } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { PLAN_MARKER, WORKLOG_MARKER, firstWith, latestWith } from '../app/(app)/lib/plan'
import { githubFor } from './adapters'
import { connectionInput } from './connection'
import { SUMMARY_MARKER, buildStagingSummary } from './summary'

type Doc = Record<string, any>
export const id = (v: unknown): number | string => (v && typeof v === 'object' ? (v as { id: number | string }).id : (v as number | string))
const o = { overrideAccess: true, depth: 0 } as const

/** A release not confirmed on staging after this long needs a human. */
export const STAGING_TIMEOUT_MS = 60 * 60_000
/** Webhook mode: staging may answer 200 from the old build right after the request, so wait this long first. */
export const WEBHOOK_SETTLE_MS = 2 * 60_000

/** PR number of `url` when it is exactly `https://github.com/<repo>/pull/<n>`; anything else is not trusted. */
export const prNumber = (url: unknown, repo: string): number | null => {
  const m = typeof url === 'string' ? new RegExp(`^https://github\\.com/${repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/pull/(\\d+)$`).exec(url) : null
  return m ? Number(m[1]) : null
}

/** Ticket source of a Product, authenticated with the Workspace's github Connection. */
export const forgeOf = async (payload: Payload, product: number | string) => {
  const src = (await payload.find({ collection: 'ticket_sources', where: { product: { equals: product } }, limit: 1, ...o })).docs[0]
  if (!src) throw new Error('no ticket source for this Product')
  const backend = githubFor(await connectionInput(payload, src.connection))
  return { backend, repo: src.repo as string, tickets: backend.tickets(src.repo) }
}

/** Posts the staging summary Comment once (idempotent by marker); the data comes from the plan, worklog, linked MRs and the latest build Run. */
export const publishStagingSummary = async (payload: Payload, t: Doc): Promise<{ posted: boolean }> => {
  const { backend, repo, tickets: ts } = await forgeOf(payload, id(t.product))
  const n = String(t.number)
  const mergeSha: string | null = t.mergeSha || null
  const comments = await ts.listComments(n)
  const posted = !latestWith(comments, SUMMARY_MARKER)?.body.includes(mergeSha ? `\`${mergeSha}\`` : SUMMARY_MARKER)
  if (posted) {
    const runs = (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: t.id } }, { stage: { equals: 'build' } }] }, sort: '-createdAt', limit: 20, ...o })).docs as Doc[]
    const numbers = [...new Set(runs.map((r) => prNumber(r.artifacts?.prUrl, repo)).filter((x): x is number => x !== null))]
    const mrs = await Promise.all(numbers.map((num) => backend.forge.getPullRequest(repo, num)))
    const product = (await payload.findByID({ collection: 'products', id: id(t.product), ...o })) as Doc
    await ts.comment(
      n,
      buildStagingSummary({
        ticket: { number: t.number, title: t.title, url: t.url },
        plan: latestWith(comments, PLAN_MARKER)?.body ?? null,
        worklog: firstWith(comments, WORKLOG_MARKER)?.body ?? null,
        mrs,
        evidence: runs.find((r) => r.artifacts?.evidence)?.artifacts.evidence ?? null,
        stagingUrl: product.stagingUrl || null,
        mergeSha,
      }),
    )
  }
  await payload.update({ collection: 'tickets', id: t.id, data: { releaseState: 'on_staging' }, overrideAccess: true })
  return { posted }
}

/** Latest run per check name (highest id; later entry wins without ids), then every picked check must have passed. */
const checksGreen = (checks: Check[], names: string[]): boolean => {
  const latest = new Map<string, Check>()
  for (const c of checks) if (!latest.has(c.name) || (c.id ?? 0) >= (latest.get(c.name)!.id ?? 0)) latest.set(c.name, c)
  const picked = names.length ? names.map((n) => latest.get(n)) : [...latest.values()]
  return picked.length > 0 && picked.every((c) => c?.status === 'completed' && ['success', 'neutral', 'skipped'].includes(c.conclusion ?? ''))
}

const stagingAnswers = async (url: string): Promise<boolean> => {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(10_000) })).status === 200
  } catch {
    return false
  }
}

/** Sets `data` on the Ticket only while `field` is still unset (or, for `releaseState`, still waiting); true when this call did it. */
const claim = async (payload: Payload, ticket: number | string, field: 'deployRequestedAt' | 'releaseState', data: Doc): Promise<boolean> =>
  (await payload.update({ collection: 'tickets', where: { and: [{ id: { equals: ticket } }, { or: field === 'releaseState' ? [{ releaseState: { equals: 'waiting' } }, { releaseState: { exists: false } }] : [{ deployRequestedAt: { exists: false } }] }] }, data, ...o })).docs.length > 0

/** Review Tickets whose MR merged move to `release`; release Tickets get their staging summary once their merge commit is on staging, or `timed_out` after 60 minutes. State is written before any side effect so a failed write never repeats a webhook or comment. */
export const watchRelease = async (payload: Payload, now = Date.now()): Promise<{ released: number; confirmed: number; timedOut: number }> => {
  const out = { released: 0, confirmed: 0, timedOut: 0 }
  const waiting = { or: [{ releaseState: { equals: 'waiting' } }, { releaseState: { exists: false } }] }
  const tickets = (await payload.find({ collection: 'tickets', where: { and: [{ state: { equals: 'open' } }, { or: [{ stage: { equals: 'review' } }, { and: [{ stage: { equals: 'release' } }, waiting] }] }] }, limit: 200, pagination: false, ...o })).docs as Doc[]
  for (const t of tickets) {
    try {
      const { backend, repo, tickets: ts } = await forgeOf(payload, id(t.product))
      const product = (await payload.findByID({ collection: 'products', id: id(t.product), ...o })) as Doc
      const n = String(t.number)
      if (t.stage === 'review') {
        const runs = (await payload.find({ collection: 'runs', where: { ticket: { equals: t.id } }, sort: '-createdAt', limit: 20, ...o })).docs as Doc[]
        const urls = runs.map((r) => r.artifacts?.prUrl).filter(Boolean)
        const num = urls.map((u) => prNumber(u, repo)).find((x) => x !== null)
        if (num == null) {
          if (urls.length) payload.logger.warn({ ticket: t.id, urls }, 'ignoring pull request URL outside the ticket source repo')
          continue
        }
        const pr = await backend.forge.getPullRequest(repo, num)
        if (pr.state === 'closed') {
          const marker = `<!-- bauherr:mr-closed:${num} -->`
          if (!(await ts.listComments(n)).some((c) => c.body.startsWith(marker))) await ts.comment(n, `${marker}\nBauherr: the MR was closed without merge; re-run Build or close the Ticket.`)
        }
        if (pr.state !== 'merged') continue
        Object.assign(t, await payload.update({ collection: 'tickets', id: t.id, data: { stage: 'release', mergeSha: pr.mergeSha ?? null, releaseAt: new Date(now).toISOString(), deployRequestedAt: null, releaseState: 'waiting' }, ...o }))
        await setStage(ts, n, 'release')
        out.released++
      }
      const names = String(product.deployChecks ?? '').split(',').map((x) => x.trim()).filter(Boolean)
      let onStaging = false
      try {
        if (product.deployMode !== 'webhook') onStaging = !!t.mergeSha && checksGreen(await backend.forge.listChecks(repo, t.mergeSha), names)
        else if (!t.deployRequestedAt) {
          if (product.deployWebhookUrl && (await claim(payload, t.id, 'deployRequestedAt', { deployRequestedAt: new Date(now).toISOString() }))) {
            const res = await fetch(product.deployWebhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket: t.number, sha: t.mergeSha, stagingUrl: product.stagingUrl ?? null }), signal: AbortSignal.timeout(10_000) }).catch((e) => ({ ok: false, status: String(e) }))
            if (!res.ok) {
              payload.logger.error({ ticket: t.id, status: res.status }, 'deploy webhook failed, retrying next tick')
              await payload.update({ collection: 'tickets', id: t.id, data: { deployRequestedAt: null }, ...o })
            }
          }
        } else onStaging = !!product.stagingUrl && now - new Date(t.deployRequestedAt).getTime() >= WEBHOOK_SETTLE_MS && (await stagingAnswers(product.stagingUrl))
      } catch (e) {
        payload.logger.error({ err: e, ticket: t.id }, 'staging probe failed')
      }
      if (onStaging) {
        await publishStagingSummary(payload, t)
        out.confirmed++
      } else if (now - new Date(t.releaseAt).getTime() > STAGING_TIMEOUT_MS && (await claim(payload, t.id, 'releaseState', { releaseState: 'timed_out' }))) {
        await ts.comment(n, 'Bauherr needs a human: staging not confirmed')
        out.timedOut++
      }
    } catch (e) {
      payload.logger.error({ err: e, ticket: t.id }, 'watch-release failed for ticket')
    }
  }
  return out
}
