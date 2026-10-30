import { setStage } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { forgeOf, publishStagingSummary } from './actions'

type Doc = Record<string, any>
const id = (v: unknown): number | string => (v && typeof v === 'object' ? (v as { id: number | string }).id : (v as number | string))
const o = { overrideAccess: true, depth: 0 } as const

/** A release not confirmed on staging after this long needs a human. */
export const STAGING_TIMEOUT_MS = 60 * 60_000
const PR_NUMBER = /\/pull\/(\d+)/

const checksGreen = (checks: { name: string; status: string; conclusion: string | null }[], names: string[]): boolean => {
  const picked = names.length ? names.map((n) => checks.find((c) => c.name === n)) : checks
  return picked.length > 0 && picked.every((c) => c?.status === 'completed' && ['success', 'neutral', 'skipped'].includes(c.conclusion ?? ''))
}

const stagingAnswers = async (url: string): Promise<boolean> => {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(10_000) })).status === 200
  } catch {
    return false
  }
}

/** Review Tickets whose MR merged move to `release`; release Tickets get their staging summary once their merge commit is on staging, or `timed_out` after 60 minutes. Returns the Tickets touched. */
export const watchRelease = async (payload: Payload, now = Date.now()): Promise<{ released: number; confirmed: number; timedOut: number }> => {
  const out = { released: 0, confirmed: 0, timedOut: 0 }
  const tickets = (await payload.find({ collection: 'tickets', where: { and: [{ state: { equals: 'open' } }, { or: [{ stage: { equals: 'review' } }, { and: [{ stage: { equals: 'release' } }, { releaseState: { equals: 'waiting' } }] }] }] }, limit: 200, pagination: false, ...o })).docs as Doc[]
  for (const t of tickets) {
    try {
      const { backend, repo, tickets: ts } = await forgeOf(payload, id(t.product))
      const product = (await payload.findByID({ collection: 'products', id: id(t.product), ...o })) as Doc
      const n = String(t.number)
      if (t.stage === 'review') {
        const runs = (await payload.find({ collection: 'runs', where: { ticket: { equals: t.id } }, sort: '-createdAt', limit: 20, ...o })).docs as Doc[]
        const num = runs.map((r) => PR_NUMBER.exec(r.artifacts?.prUrl ?? '')?.[1]).find(Boolean)
        if (!num) continue
        const pr = await backend.forge.getPullRequest(repo, Number(num))
        if (pr.state !== 'merged') continue
        await setStage(ts, n, 'release')
        const requested = product.deployMode === 'webhook' && product.deployWebhookUrl
        let deployRequestedAt: string | null = null
        if (requested) {
          const res = await fetch(product.deployWebhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket: t.number, sha: pr.mergeSha, stagingUrl: product.stagingUrl ?? null }), signal: AbortSignal.timeout(10_000) })
          if (res.ok) deployRequestedAt = new Date(now).toISOString()
          else payload.logger.error({ ticket: t.id, status: res.status }, 'deploy webhook failed')
        }
        await payload.update({ collection: 'tickets', id: t.id, data: { stage: 'release', mergeSha: pr.mergeSha ?? null, releaseAt: new Date(now).toISOString(), deployRequestedAt, releaseState: 'waiting' }, ...o })
        out.released++
        continue
      }
      const names = String(product.deployChecks ?? '').split(',').map((x) => x.trim()).filter(Boolean)
      const onStaging =
        product.deployMode === 'webhook'
          ? !!t.deployRequestedAt && !!product.stagingUrl && (await stagingAnswers(product.stagingUrl))
          : !!t.mergeSha && checksGreen(await backend.forge.listChecks(repo, t.mergeSha), names)
      if (onStaging) {
        await publishStagingSummary(payload, t)
        out.confirmed++
      } else if (now - new Date(t.releaseAt).getTime() > STAGING_TIMEOUT_MS) {
        await ts.comment(n, 'Bauherr needs a human: staging not confirmed')
        await payload.update({ collection: 'tickets', id: t.id, data: { releaseState: 'timed_out' }, ...o })
        out.timedOut++
      }
    } catch (e) {
      payload.logger.error({ err: e, ticket: t.id }, 'watch-release failed for ticket')
    }
  }
  return out
}
