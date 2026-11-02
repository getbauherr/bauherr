import { setStage, type Check, type PullRequest, type TicketSource } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
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

/** A PR the factory may review and merge: base and head in the Ticket's repo (no fork) and a head branch named `bauherr/<ticket number>-...`. */
export const isFactoryPr = (pr: PullRequest, repo: string, ticketNumber: number): boolean =>
  pr.baseRepo.toLowerCase() === repo.toLowerCase() && pr.headRepo.toLowerCase() === repo.toLowerCase() && pr.head.startsWith(`bauherr/${ticketNumber}-`)

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

/** Latest run per check name (highest id; later entry wins without ids). */
const latestChecks = (checks: Check[]): Check[] => {
  const latest = new Map<string, Check>()
  for (const c of checks) if (!latest.has(c.name) || (c.id ?? 0) >= (latest.get(c.name)!.id ?? 0)) latest.set(c.name, c)
  return [...latest.values()]
}
const passed = (c: Check | undefined): boolean => c?.status === 'completed' && ['success', 'neutral', 'skipped'].includes(c.conclusion ?? '')

/** Latest run per check name, then every picked check must have passed. */
const checksGreen = (checks: Check[], names: string[]): boolean => {
  const latest = latestChecks(checks)
  const picked = names.length ? names.map((n) => latest.find((c) => c.name === n)) : latest
  return picked.length > 0 && picked.every(passed)
}

/** CI gets this long after the head commit to register its first check before "no checks" counts as green. */
export const CHECKS_GRACE_MS = 10 * 60_000

/** Merge gate view of a head's checks: red when a finished check failed, pending while one still runs, else green. No checks at all is green only once the head commit is older than the grace period. */
export const mergeChecks = (checks: Check[], headAgeMs = Infinity): { state: 'green' | 'pending' | 'red'; failed: string[] } => {
  const latest = latestChecks(checks)
  const failed = latest.filter((c) => c.status === 'completed' && !passed(c)).map((c) => c.name)
  const pending = latest.some((c) => c.status !== 'completed') || (!latest.length && headAgeMs < CHECKS_GRACE_MS)
  return { state: failed.length ? 'red' : pending ? 'pending' : 'green', failed }
}

/** The Ticket's factory MR: the newest build Run artifact `prUrl` in the ticket source repo, with its live state; null when there is none or it is not a factory PR (fork, foreign branch). */
export const prOf = async (payload: Payload, t: Doc) => {
  const { backend, repo, tickets } = await forgeOf(payload, id(t.product))
  const runs = (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: t.id } }, { stage: { equals: 'build' } }] }, sort: '-createdAt', limit: 20, ...o })).docs as Doc[]
  const num = runs.map((r) => prNumber(r.artifacts?.prUrl, repo)).find((x) => x !== null)
  if (num == null) return null
  const pr = await backend.forge.getPullRequest(repo, num)
  return isFactoryPr(pr, repo, t.number) ? { backend, repo, tickets, pr } : null
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

/** One conditional UPDATE of a Ticket (`set` where the row still matches `where`); true when this call changed it. Payload's update-by-where is find-then-update and lets two callers both win. */
export const cas = async (payload: Payload, ticket: number | string, set: ReturnType<typeof sql>, where: ReturnType<typeof sql>): Promise<boolean> =>
  (await payload.db.drizzle.execute(sql`UPDATE "tickets" SET ${set}, "updated_at" = now() WHERE "id" = ${ticket} AND ${where} RETURNING "id"`)).rows.length > 0

export const APPROVED_STAGING = 'bauherr:approved:staging'
export const APPROVED_PRODUCTION = 'bauherr:approved:production'
export const PRODUCTION_MARKER = '<!-- bauherr:production -->'
/** A production deploy not reported by the Product's checks after this long needs a human. */
export const PRODUCTION_TIMEOUT_MS = 60 * 60_000
export const REOPENED_MARKER = '<!-- bauherr:reopened -->'

/** A merged factory MR can close its Ticket (body keyword, commit message, manual close); only acceptance on staging may. Reopens such a Ticket unless it was accepted; the comment is posted once, the forge reopen is idempotent and retried until the local state follows. */
const reopenIfClosedByMerge = async (payload: Payload, t: Doc, ts: { get(id: string): Promise<{ labels: string[] }>; listComments(id: string): Promise<{ body: string }[]>; comment(id: string, body: string): Promise<unknown>; reopen(id: string): Promise<void> }): Promise<boolean> => {
  if (t.labels?.includes(APPROVED_STAGING)) return false
  const mr = await prOf(payload, t)
  if (mr?.pr.state !== 'merged') return false
  const n = String(t.number)
  if ((await ts.get(n)).labels.includes(APPROVED_STAGING)) return false
  if (!(await ts.listComments(n)).some((c) => c.body.startsWith(REOPENED_MARKER))) {
    await ts.comment(n, `${REOPENED_MARKER}\nBauherr reopened this Ticket: the merged MR closed it, but only acceptance on staging closes a Ticket.`)
  }
  await ts.reopen(n)
  Object.assign(t, await payload.update({ collection: 'tickets', id: t.id, data: { state: 'open' }, ...o }))
  return true
}

/** Review Tickets whose MR merged move to `release`; release Tickets get their staging summary once their merge commit is on staging, or `timed_out` after 60 minutes. State is written before any side effect so a failed write never repeats a webhook or comment. */
export const watchRelease = async (payload: Payload, now = Date.now()): Promise<{ released: number; confirmed: number; timedOut: number }> => {
  const out = { released: 0, confirmed: 0, timedOut: 0 }
  const waiting = { or: [{ releaseState: { equals: 'waiting' } }, { releaseState: { exists: false } }] }
  const tickets = (await payload.find({ collection: 'tickets', where: { or: [{ and: [{ state: { equals: 'open' } }, { or: [{ stage: { equals: 'review' } }, { and: [{ stage: { equals: 'release' } }, waiting] }] }] }, { and: [{ state: { equals: 'closed' } }, { stage: { in: ['review', 'release'] } }] }] }, limit: 200, pagination: false, ...o })).docs as Doc[]
  for (const t of tickets) {
    try {
      const { backend, repo, tickets: ts } = await forgeOf(payload, id(t.product))
      const product = (await payload.findByID({ collection: 'products', id: id(t.product), ...o })) as Doc
      const n = String(t.number)
      if (t.state === 'closed' && !(await reopenIfClosedByMerge(payload, t, ts))) continue
      if (t.stage === 'release' && t.releaseState && t.releaseState !== 'waiting') continue
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
        Object.assign(t, await payload.update({ collection: 'tickets', id: t.id, data: { stage: 'release', mergeSha: pr.mergeSha ?? null, releaseAt: new Date(now).toISOString(), deployRequestedAt: null, releaseState: 'waiting', ...NO_PRODUCTION }, ...o }))
        await setStage(ts, n, 'release')
        await clearApprovalLabel(payload, ts, n)
        out.released++
      }
      const names = String(product.deployChecks ?? '').split(',').map((x) => x.trim()).filter(Boolean)
      let onStaging = false
      try {
        if (product.deployMode !== 'webhook') onStaging = !!t.mergeSha && checksGreen(await backend.forge.listChecks(repo, t.mergeSha), names)
        else if (!t.deployRequestedAt) {
          if (product.deployWebhookUrl && (await claim(payload, t.id, 'deployRequestedAt', { deployRequestedAt: new Date(now).toISOString() }))) {
            const res = await fetch(product.deployWebhookUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'x-bauherr-delivery': `${t.number}-${t.mergeSha}` }, body: JSON.stringify({ ticket: t.number, sha: t.mergeSha, stagingUrl: product.stagingUrl ?? null }), signal: AbortSignal.timeout(10_000) }).catch((e) => ({ ok: false, status: String(e) }))
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

const productionNames = (product: Doc): string[] => String(product.productionChecks ?? '').split(',').map((x) => x.trim()).filter(Boolean)

/** Ticket fields that drop any production approval and deploy; used wherever the merge commit or the gate is reset. */
export const NO_PRODUCTION = { productionState: null, productionApprovedSha: null, productionRequestedAt: null, productionWebhookSentAt: null, productionLabelAt: null } as const

/** Check runs older than the approval by more than this still count (forge and server clocks differ). */
export const CLOCK_SKEW_MS = 60_000
/** Production checks pass only on `success`: a skipped or neutral deploy job deployed nothing. */
const succeeded = (c: Check | undefined): boolean => c?.status === 'completed' && c.conclusion === 'success'

/** Sets the output label once per approval: `productionLabelAt` records the delivery, so a later removal on the forge never re-triggers label-based pipelines. Only a `deploying` Ticket that has not been delivered yet gets it. */
const deliverLabel = async (payload: Payload, ts: TicketSource, ticket: number | string, number: number): Promise<void> => {
  await ts.addLabels(String(number), [APPROVED_PRODUCTION])
  await cas(payload, ticket, sql`"production_label_at" = ${new Date().toISOString()}`, sql`"production_state" = 'deploying' AND "production_label_at" IS NULL`)
}

/** The approval label is only an output signal for label-triggered pipelines; a failed removal is logged, never trusted as state. */
export const clearApprovalLabel = (payload: Payload, ts: TicketSource, n: string) =>
  ts.removeLabels(n, [APPROVED_PRODUCTION]).catch((e) => payload.logger.error({ err: e, ticket: n }, 'could not remove the production label'))

/** Starts the production deploy of a Ticket in `awaiting_approval | failed | timed_out` after an explicit approval by a person: the human touch is written first (no deploy without an audit row; removed again when the CAS is lost), then one CAS records the approval for the current merge sha and moves to `deploying` (a lost race or a changed merge sha changes nothing), then the output label. A label failure is retried by `watchProduction`. The Product's pipeline reacts to the label or the webhook; the factory deploys nothing. */
export const beginProduction = async (payload: Payload, t: Doc, actor: string, now = Date.now()): Promise<void> => {
  const product = (await payload.findByID({ collection: 'products', id: id(t.product), ...o })) as Doc
  if (!productionNames(product).length) throw new Error('configure productionChecks on the Product first')
  if (!t.mergeSha) throw new Error('the Ticket has no merge commit to deploy')
  const at = new Date(now).toISOString()
  const touch = await payload.create({ collection: 'human_touches', data: { kind: 'approve:production', ticket: t.id, workspace: id(t.workspace), actor, at }, ...o })
  const won = await cas(payload, t.id, sql`"production_state" = 'deploying', "production_approved_sha" = ${t.mergeSha}, "production_requested_at" = ${at}, "production_webhook_sent_at" = NULL, "production_label_at" = NULL`, sql`"merge_sha" = ${t.mergeSha} AND "production_state" IN ('awaiting_approval', 'failed', 'timed_out')`)
  if (!won) {
    await payload.delete({ collection: 'human_touches', id: touch.id, ...o })
    throw new Error('the Ticket is not waiting for production approval')
  }
  const { tickets: ts } = await forgeOf(payload, id(t.product))
  await deliverLabel(payload, ts, t.id, t.number).catch((e) => payload.logger.error({ err: e, ticket: t.id }, 'could not set the production label, retrying'))
}

/** Moves a `deploying` Ticket to `to` once; false when another pass already did. A failed or timed out deploy spends the approval (record and label). */
const moveProduction = async (payload: Payload, t: Doc, ts: TicketSource, to: 'deployed' | 'failed' | 'timed_out'): Promise<boolean> => {
  const won = await cas(payload, t.id, to === 'deployed' ? sql`"production_state" = ${to}` : sql`"production_state" = ${to}, "production_approved_sha" = NULL`, sql`"production_state" = 'deploying'`)
  if (won && to !== 'deployed') await clearApprovalLabel(payload, ts, String(t.number))
  return won
}

/** The single production Comment (updated on a retry): result, sha, checks, approver, time. */
const postProduction = async (payload: Payload, t: Doc, ts: TicketSource, result: string, names: string[]) => {
  const n = String(t.number)
  const touch = (await payload.find({ collection: 'human_touches', where: { and: [{ ticket: { equals: t.id } }, { kind: { equals: 'approve:production' } }] }, sort: '-at', limit: 1, ...o })).docs[0] as Doc | undefined
  const body = `${PRODUCTION_MARKER}\nProduction deploy ${result}\n- sha: \`${t.mergeSha}\`\n- checks: ${names.join(', ')}\n- approved by: ${touch?.actor ?? 'unknown'} at ${touch?.at ?? 'unknown'}`
  const existing = latestWith(await ts.listComments(n), PRODUCTION_MARKER)
  if (existing) await ts.updateComment(n, existing.id, body)
  else await ts.comment(n, body)
}

const finishDeployed = async (payload: Payload, t: Doc, ts: TicketSource, names: string[]) => {
  const n = String(t.number)
  await postProduction(payload, t, ts, 'succeeded', names)
  await setStage(ts, n, 'done')
  await ts.close(n, 'completed')
  Object.assign(t, await payload.update({ collection: 'tickets', id: t.id, data: { stage: 'done', state: 'closed' }, ...o }))
}

/**
 * Production observer. The deploy starts only through `beginProduction` (owner approval); a forge label never starts it. A `deploying` Ticket gets the optional webhook once and its output label until one add succeeded (never again afterwards), then the Product's `productionChecks` on the merge commit decide, counting only runs that started at or after `productionRequestedAt` minus a 60 s clock-skew margin (older runs are a previous attempt): all `success` is `deployed` (done, closed), a finished red one `failed`, nothing after 60 minutes `timed_out`. State is claimed before side effects. Returns the Tickets that just became `deployed`.
 */
export const watchProduction = async (payload: Payload, now = Date.now()): Promise<{ released: Doc[] }> => {
  const released: Doc[] = []
  const tickets = (await payload.find({ collection: 'tickets', where: { and: [{ stage: { equals: 'release' } }, { productionState: { in: ['deploying', 'deployed'] } }] }, limit: 200, pagination: false, ...o })).docs as Doc[]
  for (const t of tickets) {
    try {
      const { backend, repo, tickets: ts } = await forgeOf(payload, id(t.product))
      const product = (await payload.findByID({ collection: 'products', id: id(t.product), ...o })) as Doc
      const names = productionNames(product)
      if (t.productionState === 'deployed') {
        await finishDeployed(payload, t, ts, names)
        continue
      }
      if (!t.mergeSha || t.productionApprovedSha !== t.mergeSha) {
        if (await moveProduction(payload, t, ts, 'failed')) await postProduction(payload, t, ts, 'failed: the approval does not match the merge commit', names)
        continue
      }
      const fresh = (await payload.findByID({ collection: 'tickets', id: t.id, ...o })) as Doc
      if (fresh.productionState === 'deploying' && !fresh.productionLabelAt) await deliverLabel(payload, ts, t.id, t.number).catch((e) => payload.logger.error({ err: e, ticket: t.id }, 'could not set the production label, retrying'))
      const requested = new Date(t.productionRequestedAt).getTime()
      const since = requested - CLOCK_SKEW_MS
      if (product.productionWebhookUrl && !t.productionWebhookSentAt && (await cas(payload, t.id, sql`"production_webhook_sent_at" = ${new Date(now).toISOString()}`, sql`"production_webhook_sent_at" IS NULL`))) {
        const res = await fetch(product.productionWebhookUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'x-bauherr-delivery': `${t.number}-${t.mergeSha}` }, body: JSON.stringify({ ticket: t.number, sha: t.mergeSha, environment: 'production' }), signal: AbortSignal.timeout(10_000) }).catch((e) => ({ ok: false, status: String(e) }))
        if (!res.ok) {
          payload.logger.error({ ticket: t.id, status: res.status }, 'production webhook failed, retrying next tick')
          await payload.update({ collection: 'tickets', id: t.id, data: { productionWebhookSentAt: null }, ...o })
        }
      }
      const latest = latestChecks(t.mergeSha ? (await backend.forge.listChecks(repo, t.mergeSha)).filter((c) => c.startedAt && new Date(c.startedAt).getTime() >= since) : [])
      const picked = names.map((n) => latest.find((c) => c.name === n))
      const bad = picked.find((c) => c?.status === 'completed' && c.conclusion !== 'success')
      if (picked.length && picked.every(succeeded)) {
        if (await moveProduction(payload, t, ts, 'deployed')) {
          await finishDeployed(payload, t, ts, names)
          released.push(t)
        }
      } else if (bad) {
        if (await moveProduction(payload, t, ts, 'failed')) await postProduction(payload, t, ts, ['skipped', 'neutral'].includes(bad.conclusion ?? '') ? `failed: deploy check skipped (${bad.name})` : 'failed', names)
      } else if (now - requested > PRODUCTION_TIMEOUT_MS && (await moveProduction(payload, t, ts, 'timed_out'))) await postProduction(payload, t, ts, 'timed out', names)
    } catch (e) {
      payload.logger.error({ err: e, ticket: t.id }, 'watch-production failed for ticket')
    }
  }
  return { released }
}
