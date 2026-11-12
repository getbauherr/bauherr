import { type Check, type Forge, type PullRequest, type Release, type TicketSource } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import type { Payload, PayloadRequest, Where } from 'payload'
import { PLAN_MARKER, WORKLOG_MARKER, firstWith, latestWith } from '../app/(app)/lib/plan'
import { backendFor } from './adapters'
import { retryRed, settleRetries } from './check-retry'
import { connectionInput, webOrigin } from './connection'
import { EXPEDITE_SKIP_TOUCH } from './needs-you'
import { APPROVED_STAGING, GATE_LABELS, gateIsOn, verifyGateLabels } from './gate-labels'
import { completeCheap } from './gateway'
import { collectItem, nextVersion, renderNotes, rewrite } from './release-notes'
import { gateOn, productionGateOn, stagingGateOn } from './mode'
import { record } from './history'
import { inKindStage } from './stage-scope'
import { moveStage } from './stage-move'
import { personOf } from './person'
import { decidingAs, ownerAssigned, productOwnersOf } from './people'
import { SUMMARY_MARKER, buildStagingSummary } from './summary'
import { proofMarkdown } from './artifacts'
import { publicUrl } from './oidc'
import { workflowFor } from './factory'
import { stagingTldrOf, storeStagingTldr } from './decision'
import { headingOf, noteTemplates, template } from './templates'
import { byKind, is, nameOf } from './workflow'

type Doc = Record<string, any>
export const id = (v: unknown): number | string => (v && typeof v === 'object' ? (v as { id: number | string }).id : (v as number | string))
const o = { overrideAccess: true, depth: 0 } as const

/** A release not confirmed on staging after this long needs a human. */
export const STAGING_TIMEOUT_MS = 60 * 60_000
/** Webhook mode: staging may answer 200 from the old build right after the request, so wait this long first. */
export const WEBHOOK_SETTLE_MS = 2 * 60_000

/** PR number of `url` when it is exactly `<web>/<repo>/pull/<n>` (GitHub) or `<web>/<repo>/-/merge_requests/<n>` (GitLab); `web` is the Connection's origin, anything else is not trusted. */
export const prNumber = (url: unknown, repo: string, web: string): number | null => {
  const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = typeof url === 'string' ? new RegExp(`^${esc(web)}/${esc(repo)}/(?:-/merge_requests|pull)/(\\d+)$`).exec(url) : null
  return m ? Number(m[1]) : null
}

/** A PR the factory may review and merge: base and head in the Ticket's repo (no fork) and a head branch named `bauherr/<ticket number>-...`. */
export const isFactoryPr = (pr: PullRequest, repo: string, ticketNumber: number): boolean =>
  pr.baseRepo.toLowerCase() === repo.toLowerCase() && pr.headRepo.toLowerCase() === repo.toLowerCase() && pr.head.startsWith(`bauherr/${ticketNumber}-`)

/** Throws unless `prUrl` is an open factory MR of the Ticket (same repo, branch `bauherr/<number>-...`). */
export const assertOpenFactoryMr = async (payload: Payload, ticket: Doc, prUrl: unknown): Promise<void> => {
  const { backend, repo, web } = await forgeOf(payload, id(ticket.product))
  const num = prNumber(prUrl, repo, web)
  const pr = num == null ? null : await backend.forge.getPullRequest(repo, num)
  if (!pr || pr.state !== 'open' || !isFactoryPr(pr, repo, ticket.number)) {
    throw new Error(`prUrl must be an open pull request in ${repo} (not a fork) from a branch named bauherr/${ticket.number}-...`)
  }
}

/** Ticket source of a Product, authenticated with the Workspace's forge Connection; `web` is that forge's origin. */
export const forgeOf = async (payload: Payload, product: number | string, req?: Partial<PayloadRequest>) => {
  const src = (await payload.find({ collection: 'ticket_sources', where: { product: { equals: product } }, limit: 1, ...o, req })).docs[0]
  if (!src) throw new Error('no ticket source for this Product')
  const connection = await connectionInput(payload, src.connection, req)
  const backend = backendFor(connection)
  return { backend, repo: src.repo as string, web: webOrigin(connection), tickets: backend.tickets(src.repo), kind: connection.kind === 'gitlab' ? ('gitlab' as const) : ('github' as const) }
}

/** Posts the staging summary Comment once (idempotent by marker); the data comes from the plan, worklog, linked MRs and the latest build Run. */
export const publishStagingSummary = async (payload: Payload, t: Doc): Promise<{ posted: boolean }> => {
  const { backend, repo, web, tickets: ts } = await forgeOf(payload, id(t.product))
  const n = String(t.number)
  const mergeSha: string | null = t.mergeSha || null
  const comments = await ts.listComments(n)
  const posted = !latestWith(comments, SUMMARY_MARKER)?.body.includes(mergeSha ? `\`${mergeSha}\`` : SUMMARY_MARKER)
  if (posted) {
    const runs = (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: t.id } }, { kind: { equals: 'build' } }] }, sort: '-createdAt', limit: 20, ...o })).docs as Doc[]
    const numbers = [...new Set(runs.map((r) => prNumber(r.artifacts?.prUrl, repo, web)).filter((x): x is number => x !== null))]
    const mrs = await Promise.all(numbers.map((num) => backend.forge.getPullRequest(repo, num)))
    const product = (await payload.findByID({ collection: 'products', id: id(t.product), ...o })) as Doc
    const tpl = await template(payload, id(t.workspace), 'staging-summary')
    const summary = buildStagingSummary({
        ticket: { number: t.number, title: t.title, url: t.url },
        plan: latestWith(comments, PLAN_MARKER)?.body ?? null,
        worklog: firstWith(comments, WORKLOG_MARKER)?.body ?? null,
        mrs,
        evidence: runs.find((r) => r.artifacts?.evidence)?.artifacts.evidence ?? null,
        stagingUrl: product.stagingUrl || null,
        mergeSha,
        proof: await proofMarkdown(payload, t, `${publicUrl()}/tickets/${t.id}`),
      }, tpl)
    await ts.comment(n, summary)
    await storeStagingTldr(payload, t.id, stagingTldrOf(summary, { whatYouGet: headingOf(tpl, 'what-you-get'), found: headingOf(tpl, 'found') }))
  }
  await payload.update({ collection: 'tickets', id: t.id, data: { releaseState: 'on_staging' }, overrideAccess: true })
  await record(payload, t.id, { cause: 'release:on_staging' })
  return { posted }
}

/** Latest run per check name (highest id; later entry wins without ids). */
export const latestChecks = (checks: Check[]): Check[] => {
  const latest = new Map<string, Check>()
  for (const c of checks) if (!latest.has(c.name) || (c.id ?? 0) >= (latest.get(c.name)!.id ?? 0)) latest.set(c.name, c)
  return [...latest.values()]
}
export const passed = (c: Check | undefined): boolean => c?.status === 'completed' && ['success', 'neutral', 'skipped'].includes(c.conclusion ?? '')
export const failedCheck = (c: Check | undefined): c is Check => c?.status === 'completed' && !passed(c)

/** Latest run per check name, then every picked check must have passed. */
const checksGreen = (checks: Check[], names: string[]): boolean => {
  const latest = latestChecks(checks)
  const picked = names.length ? names.map((n) => latest.find((c) => c.name === n)) : latest
  return picked.length > 0 && picked.every(passed)
}

/** The default branch tip and its checks, looked up once per repo and tick and shared by every waiting Ticket. */
type Tip = { sha: string; checks: Check[] } | null
const tipOf = async (forge: Forge, repo: string): Promise<Tip> => {
  const tip = await forge.getBranch(repo, (await forge.getRepository(repo)).defaultBranch)
  return tip ? { sha: tip.sha, checks: await forge.listChecks(repo, tip.sha) } : null
}

/** Staging runs the newest default-branch commit, so a Ticket is confirmed when its merge commit, or the branch tip descending from it (a batch tip, a queue group), is green. Polled every minute: mergeSha's pending checks cost no further call, the tip is looked up only once they have completed without going green. */
const stagingConfirmed = async (forge: Forge, repo: string, mergeSha: string, mergeChecksList: Check[], names: string[], tips: Map<string, Promise<Tip>>): Promise<boolean> => {
  if (checksGreen(mergeChecksList, names)) return true
  if (latestChecks(mergeChecksList).some((c) => c.status !== 'completed')) return false
  if (!tips.has(repo)) tips.set(repo, tipOf(forge, repo))
  const tip = await tips.get(repo)!
  return !!tip && tip.sha !== mergeSha && checksGreen(tip.checks, names) && (await forge.isAncestor(repo, mergeSha, tip.sha))
}

/** CI gets this long after the head commit to register its first check before "no checks" counts as green. */
export const CHECKS_GRACE_MS = 10 * 60_000

/** Merge gate view of a head's checks: red when a finished check failed, pending while one still runs, else green. No checks at all is green only once the head commit is older than the grace period. */
export const mergeChecks = (checks: Check[], headAgeMs = Infinity): { state: 'green' | 'pending' | 'red'; failed: string[] } => {
  const latest = latestChecks(checks)
  const failed = latest.filter(failedCheck).map((c) => c.name)
  const pending = latest.some((c) => c.status !== 'completed') || (!latest.length && headAgeMs < CHECKS_GRACE_MS)
  return { state: failed.length ? 'red' : pending ? 'pending' : 'green', failed }
}

/**
 * The Ticket's factory MR: the newest build Run artifact `prUrl` in the ticket source repo, with its live state.
 * When that MR was closed unmerged (or is not a factory MR), or a Ticket in review/release has none linked, the newest open factory MR of the Ticket (head `bauherr/<number>-*`) stands in, so a replacement MR is reviewed and merged with no DB edit.
 * Null when there is none. `{ fallback: false }` answers only for the linked MR (the liveness watchdog uses it to find Tickets whose link went stale).
 */
export const prOf = async (payload: Payload, t: Doc, o2: { fallback?: boolean } = {}) => {
  const { backend, repo, web, tickets } = await forgeOf(payload, id(t.product))
  const runs = (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: t.id } }, { kind: { equals: 'build' } }] }, sort: '-createdAt', limit: 20, ...o })).docs as Doc[]
  const num = runs.map((r) => prNumber(r.artifacts?.prUrl, repo, web)).find((x) => x !== null)
  if (num != null) {
    const pr = await backend.forge.getPullRequest(repo, num)
    if (isFactoryPr(pr, repo, t.number) && pr.state !== 'closed') return { backend, repo, tickets, pr }
  } else if (!is(workflowFor(t.workspace), t.stage, 'review', 'release')) return null
  if (o2.fallback === false) return null
  const open = (await backend.forge.listPullRequests(repo, 'open')).filter((p) => p.state === 'open' && isFactoryPr(p, repo, t.number)).sort((a, b) => b.number - a.number)[0]
  return open ? { backend, repo, tickets, pr: open } : null
}

const stagingAnswers = async (url: string): Promise<boolean> => {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(10_000) })).status === 200
  } catch {
    return false
  }
}

/** One conditional UPDATE of a Ticket (`set` where the row still matches `where`); true when this call changed it. Payload's update-by-where is find-then-update and lets two callers both win. */
export const cas = async (payload: Payload, ticket: number | string, set: ReturnType<typeof sql>, where: ReturnType<typeof sql>): Promise<boolean> =>
  (await payload.db.drizzle.execute(sql`UPDATE "tickets" SET ${set}, "updated_at" = now() WHERE "id" = ${ticket} AND ${where} RETURNING "id"`)).rows.length > 0

export { APPROVED_STAGING }
export const APPROVED_PRODUCTION = 'bauherr:approved:production'
export const PRODUCTION_MARKER = '<!-- bauherr:production -->'
/** A production deploy not reported by the Product's checks after this long needs a human. */
export const PRODUCTION_TIMEOUT_MS = 60 * 60_000
export const REOPENED_MARKER = '<!-- bauherr:reopened -->'

export const DROPPED_MARKER = '<!-- bauherr:dropped -->'

/** Decides a closed review/release Ticket once. A Ticket reopened on the forge before this pass is only synced back to open. A merged factory MR can close its Ticket (body keyword, commit message, manual close) but only acceptance on staging may: such a `completed` close is reopened (comment once, forge reopen retried until the local state follows). Accepted Tickets, `not_planned`/`duplicate` closes and closes before any merge are settled as `done` (note once, state written last so a failed forge call is retried) and no longer match the watcher query. A Ticket held for production approval is left alone. */
const decideClosed = async (payload: Payload, t: Doc, ts: TicketSource): Promise<'reopened' | 'dropped' | 'held'> => {
  const n = String(t.number)
  const syncOpen = async (): Promise<'reopened'> => {
    if (await cas(payload, t.id, sql`"state" = 'open'`, sql`"state" = 'closed'`)) Object.assign(t, await payload.findByID({ collection: 'tickets', id: t.id, ...o }))
    return 'reopened'
  }
  const issue = await ts.get(n)
  if (issue.state === 'open') return syncOpen()
  const accepted = gateIsOn(workflowFor(t.workspace), 'staging')
    ? t.labels?.includes(APPROVED_STAGING) || (await verifyGateLabels(payload, t, issue.labels, ts, GATE_LABELS.filter((g) => g.label === APPROVED_STAGING))).accepted.length > 0
    : !!t.productionState
  if (accepted && t.productionState) return 'held'
  const merged = !accepted && (await prOf(payload, t))?.pr.state === 'merged'
  const reason = issue.closeReason ?? 'completed'
  const note = async (marker: string, body: string) => {
    if (!(await ts.listComments(n)).some((c) => c.body.startsWith(marker))) await ts.comment(n, `${marker}\n${body}`)
  }
  if (merged && reason === 'completed') {
    await note(REOPENED_MARKER, 'Bauherr reopened this Ticket: the merged MR closed it, but only acceptance on staging closes a Ticket. To drop it, close it as not planned.')
    await ts.reopen(n)
    return syncOpen()
  }
  if (!accepted) await note(DROPPED_MARKER, 'Bauherr: this Ticket was closed by a human, not by acceptance; it is left closed and set to done.')
  const done = nameOf(workflowFor(t.workspace), 'done')
  await moveStage(payload, ts, t, done, 'closed_by_human')
  await cas(payload, t.id, sql`"stage" = ${done}`, sql`"state" = 'closed'`)
  Object.assign(t, await payload.findByID({ collection: 'tickets', id: t.id, ...o }))
  return 'dropped'
}

/**
 * Staging passes: the Ticket moves to `done` (closed) unless the Product's production gate is on (workflow `production_gate` or `Product.productionGate`), then it waits for production approval; without `productionChecks` the Ticket shows the "Configure production checks" gate instead (see `needsYou`).
 * `touch` records the human acceptance; the automatic path (release gate off) records an `auto:staging` touch of the factory, which is also what makes its label verifiable.
 */
export const passStaging = async (payload: Payload, t: Doc, human?: () => Promise<unknown>, skip?: Doc): Promise<{ approved: string; stage: string }> => {
  const wf = workflowFor(t.workspace)
  const { tickets: ts } = await forgeOf(payload, id(t.product))
  const n = String(t.number)
  const touch = human ?? (() => payload.create({ collection: 'human_touches', data: { kind: skip ? EXPEDITE_SKIP_TOUCH : 'auto:staging', ticket: t.id, workspace: id(t.workspace), actor: 'factory', at: new Date().toISOString(), ...(skip && { status: `Product setting expediteSkipStaging, enabled by ${skip.expediteSkipStagingBy ?? 'unknown'} at ${skip.expediteSkipStagingAt ?? 'unknown'}` }) }, ...o }))
  // remove first so the label event is the factory's own, not an earlier agent's
  const label = async () => {
    await touch()
    await ts.removeLabels(n, [APPROVED_STAGING])
    await ts.addLabels(n, [APPROVED_STAGING])
  }
  const product = (await payload.findByID({ collection: 'products', id: id(t.product), ...o })) as Doc
  const stage = nameOf(wf, productionGateOn(wf, product) ? 'release' : 'done')
  const closes = is(wf, stage, 'done')
  if (closes) {
    await moveStage(payload, ts, t, stage, 'accept_staging')
    await payload.update({ collection: 'tickets', id: t.id, data: { stage }, ...o })
  } else if (!(await cas(payload, t.id, sql`"production_state" = 'awaiting_approval'`, sql`"production_state" IS NULL`))) {
    await label()
    return { approved: APPROVED_STAGING, stage }
  }
  await label()
  await record(payload, t.id, { cause: 'staging:accepted' })
  if (closes) {
    await ts.close(n, 'completed')
    await payload.update({ collection: 'tickets', id: t.id, data: { state: 'closed' }, ...o })
  }
  return { approved: APPROVED_STAGING, stage }
}

/** Review Tickets whose MR merged move to `release`; release Tickets get their staging summary once their merge commit is on staging, or `timed_out` after 60 minutes. State is written before any side effect so a failed write never repeats a webhook or comment. */
export const watchRelease = async (payload: Payload, now = Date.now()): Promise<{ released: number; confirmed: number; timedOut: number }> => {
  const out = { released: 0, confirmed: 0, timedOut: 0 }
  const tips = new Map<string, Promise<Tip>>()
  const stages = new Map(
    (await payload.find({ collection: 'workspaces', select: {}, pagination: false, ...o })).docs.flatMap((w) => {
      const wf = workflowFor(w.id)
      const review = byKind(wf, 'review')?.name
      const release = byKind(wf, 'release')?.name
      return review && release ? [[Number(w.id), { review, release, auto: !gateOn(wf, 'release'), wf }] as const] : []
    }),
  )
  if (!stages.size) return out
  const owners = new Map<number, Promise<Doc[]>>()
  /** Whether staging acceptance is asked for this Product (see `stagingGateOn`); the owner lookup is one query per Workspace and sweep, and only for a workflow that asks the Product owner. */
  const stagingAsked = async (wf: ReturnType<typeof workflowFor>, p: Doc): Promise<boolean> => {
    const ws = Number(id(p.workspace))
    if (!owners.has(ws)) owners.set(ws, productOwnersOf(payload, ws))
    return stagingGateOn(wf, p, ownerAssigned(await owners.get(ws)!, { id: p.id, workspace: ws }))
  }
  /** `auto`: staging acceptance is not asked of every Product, so every Ticket on staging is looked at (a gate that asks the Product owner is decided per Product below). */
  const whereOf = (ws: number, { review, release, auto }: { review: string; release: string; auto: boolean }): Where => {
    const waiting: Where = { or: [{ releaseState: { equals: 'waiting' } }, { releaseState: { exists: false } }, ...(auto ? [{ releaseState: { equals: 'on_staging' } }] : [{ and: [{ releaseState: { equals: 'on_staging' } }, { expedite: { equals: true } }] }])] }
    return { and: [{ workspace: { equals: ws } }, { or: [{ and: [{ state: { equals: 'open' } }, { or: [{ stage: { equals: review } }, { and: [{ stage: { equals: release } }, waiting] }] }] }, { and: [{ state: { equals: 'closed' } }, { stage: { in: [review, release] } }] }] }] }
  }
  const tickets = (await payload.find({ collection: 'tickets', where: { or: [...stages].map(([ws, st]) => whereOf(ws, st)) }, limit: 200, pagination: false, ...o })).docs as Doc[]
  for (const t of tickets) {
    try {
      const { review, release, wf, auto: loose } = stages.get(Number(id(t.workspace)))!
      const { backend, repo, web, tickets: ts } = await forgeOf(payload, id(t.product))
      const product = (await payload.findByID({ collection: 'products', id: id(t.product), ...o })) as Doc
      const n = String(t.number)
      const auto = loose && !(await stagingAsked(wf, product))
      if (t.state === 'closed' && (await decideClosed(payload, t, ts)) !== 'reopened') continue
      // Product `expediteSkipStaging` is the human decision to skip the staging gate for a Hotfix; passStaging still records the staging touch.
      if (t.stage === release && (auto || (t.expedite && product.expediteSkipStaging)) && t.releaseState === 'on_staging') {
        if (!t.productionState) await passStaging(payload, t, undefined, auto ? undefined : product)
        continue
      }
      if (t.stage === release && t.releaseState && t.releaseState !== 'waiting') continue
      if (t.stage === review) {
        const runs = (await payload.find({ collection: 'runs', where: { ticket: { equals: t.id } }, sort: '-createdAt', limit: 20, ...o })).docs as Doc[]
        const urls = runs.map((r) => r.artifacts?.prUrl).filter(Boolean)
        const num = urls.map((u) => prNumber(u, repo, web)).find((x) => x !== null)
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
        const at = new Date(now).toISOString()
        if (!(await cas(payload, t.id, sql`"stage" = ${release}, "review_state" = CASE WHEN "review_state" = 'queued' THEN 'merged'::"enum_tickets_review_state" ELSE "review_state" END, "merge_sha" = ${pr.mergeSha ?? null}, "release_at" = ${at}, "deploy_requested_at" = NULL, "release_state" = 'waiting', "production_state" = NULL, "production_approved_sha" = NULL, "production_requested_at" = NULL, "production_webhook_sent_at" = NULL, "production_label_at" = NULL`, sql`"stage" = ${review}`))) continue
        Object.assign(t, await payload.findByID({ collection: 'tickets', id: t.id, ...o }))
        await moveStage(payload, ts, t, release, 'merged')
        await clearApprovalLabel(payload, ts, n)
        out.released++
      }
      const names = String(product.deployChecks ?? '').split(',').map((x) => x.trim()).filter(Boolean)
      let onStaging = false
      try {
        if (product.deployMode !== 'webhook') {
          if (t.mergeSha) {
            const list = await backend.forge.listChecks(repo, t.mergeSha)
            await settleRetries(payload, t, t.mergeSha, list)
            onStaging = await stagingConfirmed(backend.forge, repo, t.mergeSha, list, names, tips)
            const failed = latestChecks(list).filter((c) => (!names.length || names.includes(c.name)) && failedCheck(c))
            if (!onStaging && failed.length) await retryRed(payload, t, product, { backend, repo, tickets: ts }, t.mergeSha, failed, latestChecks(list))
          }
        } else if (!t.deployRequestedAt) {
          if (product.deployWebhookUrl && (await cas(payload, t.id, sql`"deploy_requested_at" = ${new Date(now).toISOString()}`, sql`"deploy_requested_at" IS NULL`))) {
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
        if (auto) await passStaging(payload, t)
        out.confirmed++
      } else if (now - new Date(t.releaseAt).getTime() > STAGING_TIMEOUT_MS && (await cas(payload, t.id, sql`"release_state" = 'timed_out'`, sql`("release_state" = 'waiting' OR "release_state" IS NULL)`))) {
        await ts.comment(n, 'Bauherr needs a human: staging not confirmed')
        await record(payload, t.id, { cause: 'release:timed_out' })
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
export const beginProduction = async (payload: Payload, t: Doc, user: Doc, now = Date.now(), addressee?: 'bauherr' | 'product-owner'): Promise<void> => {
  const product = (await payload.findByID({ collection: 'products', id: id(t.product), ...o })) as Doc
  if (!productionNames(product).length) throw new Error('configure productionChecks on the Product first')
  if (!t.mergeSha) throw new Error('the Ticket has no merge commit to deploy')
  const at = new Date(now).toISOString()
  const touch = await payload.create({ collection: 'human_touches', data: { kind: 'approve:production', ticket: t.id, workspace: id(t.workspace), actor: personOf(user), as: decidingAs(user), ...(addressee && { addressee }), at }, ...o })
  const won = await cas(payload, t.id, sql`"production_state" = 'deploying', "production_approved_sha" = ${t.mergeSha}, "production_requested_at" = ${at}, "production_webhook_sent_at" = NULL, "production_label_at" = NULL`, sql`"merge_sha" = ${t.mergeSha} AND "production_state" IN ('awaiting_approval', 'failed', 'timed_out')`)
  if (!won) {
    await payload.delete({ collection: 'human_touches', id: touch.id, ...o })
    throw new Error('the Ticket is not waiting for production approval')
  }
  await record(payload, t.id, { cause: 'gate:approve:production', executor: 'human', actor: personOf(user) })
  const { tickets: ts } = await forgeOf(payload, id(t.product))
  await deliverLabel(payload, ts, t.id, t.number).catch((e) => payload.logger.error({ err: e, ticket: t.id }, 'could not set the production label, retrying'))
}

/** Moves a `deploying` Ticket to `to` once; false when another pass already did. A failed or timed out deploy spends the approval (record and label). */
const moveProduction = async (payload: Payload, t: Doc, ts: TicketSource, to: 'deployed' | 'failed' | 'timed_out'): Promise<boolean> => {
  const won = await cas(payload, t.id, to === 'deployed' ? sql`"production_state" = ${to}` : sql`"production_state" = ${to}, "production_approved_sha" = NULL`, sql`"production_state" = 'deploying'`)
  if (won && to !== 'deployed') await clearApprovalLabel(payload, ts, String(t.number))
  if (won) await record(payload, t.id, { cause: `production:${to}` })
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
  const done = nameOf(workflowFor(t.workspace), 'done')
  await moveStage(payload, ts, t, done, 'production_deployed')
  await ts.close(n, 'completed')
  Object.assign(t, await payload.update({ collection: 'tickets', id: t.id, data: { stage: done, state: 'closed' }, ...o }))
}

/**
 * Production observer. The deploy starts only through `beginProduction` (owner approval); a forge label never starts it. A `deploying` Ticket gets the optional webhook once and its output label until one add succeeded (never again afterwards), then the Product's `productionChecks` on the merge commit decide, counting only runs that started at or after `productionRequestedAt` minus a 60 s clock-skew margin (older runs are a previous attempt): all `success` is `deployed` (done, closed), a finished red one `failed`, nothing after 60 minutes `timed_out`. State is claimed before side effects. Returns the Tickets that just became `deployed`.
 */
export const watchProduction = async (payload: Payload, now = Date.now()): Promise<{ released: Doc[] }> => {
  const released: Doc[] = []
  const tickets = (await payload.find({ collection: 'tickets', where: { and: [await inKindStage(payload, 'release'), { productionState: { in: ['deploying', 'deployed'] } }] }, limit: 200, pagination: false, ...o })).docs as Doc[]
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
      if (t.mergeSha) await settleRetries(payload, t, t.mergeSha, latest)
      const picked = names.map((n) => latest.find((c) => c.name === n))
      const bad = picked.find((c) => c?.status === 'completed' && c.conclusion !== 'success')
      if (picked.length && picked.every(succeeded)) {
        if (await moveProduction(payload, t, ts, 'deployed')) {
          await finishDeployed(payload, t, ts, names)
          released.push(t)
        }
      } else if (bad) {
        if (failedCheck(bad) && now - requested <= PRODUCTION_TIMEOUT_MS && (await retryRed(payload, t, product, { backend, repo, tickets: ts }, t.mergeSha, [bad], latest)) === 'retried') continue
        if (await moveProduction(payload, t, ts, 'failed')) await postProduction(payload, t, ts, ['skipped', 'neutral'].includes(bad.conclusion ?? '') ? `failed: deploy check skipped (${bad.name})` : 'failed', names)
      } else if (now - requested > PRODUCTION_TIMEOUT_MS && (await moveProduction(payload, t, ts, 'timed_out'))) await postProduction(payload, t, ts, 'timed out', names)
    } catch (e) {
      payload.logger.error({ err: e, ticket: t.id }, 'watch-production failed for ticket')
    }
  }
  return { released }
}

export const releaseMarker = (sha: string) => `<!-- bauherr:release:${sha} -->`
/** `notes-only` Product with no release for the deployed commit after this long: the notes go on the Tickets, nothing is created. */
export const RELEASE_WAIT_MS = 6 * 60 * 60_000

/** Prepends the release to CHANGELOG.md (after `## Unreleased`) on `bauherr/release-<tag>` and opens an MR; a human merges it. Safe to repeat: an existing branch or MR is kept. */
export const changelogPr = async (forge: Forge, repo: string, release: Release, marker: string, now: number) => {
  const branch = `bauherr/release-${release.tag}`
  const base = (await forge.getRepository(repo)).defaultBranch
  if (!(await forge.listBranches(repo)).some((b) => b.name === branch)) {
    const file = await forge.getFile(repo, 'CHANGELOG.md', base)
    if (!/^## Unreleased.*$/m.test(file.content)) throw new Error('CHANGELOG.md has no "## Unreleased" heading')
    const entry = `## ${release.tag.replace(/^v/, '')} - ${new Date(now).toISOString().slice(0, 10)}\n\n${release.body.replace(marker, '').trim()}\n`
    await forge.createBranch(repo, branch, base)
    await forge.putFile(repo, { branch, path: 'CHANGELOG.md', content: file.content.replace(/^(## Unreleased.*)$/m, `$1\n\n${entry}`), message: `docs(changelog): ${release.tag}`, expectSha: file.sha })
  }
  if (!(await forge.listPullRequests(repo, 'all')).some((p) => p.head === branch)) await forge.openPullRequest(repo, { title: `docs(changelog): ${release.tag}`, head: branch, base, body: `Changelog entry for [${release.tag}](${release.url}).` })
}

/** While a `notes-only` Product's tooling has not made the release yet, look again after this long. */
export const RELEASE_POLL_MS = 10 * 60_000
/** After a failed publish, retry after this long; the 3rd failure gives up. */
export const RELEASE_RETRY_MS = 60 * 60_000
export const RELEASE_MAX_ATTEMPTS = 3

/** Tickets approved for production whose release is not published and not given up on, optionally narrowed. */
const unreleased = (extra: Doc[] = []) => ({ and: [{ productionApprovedSha: { exists: true } }, { productionState: { in: ['deploying', 'deployed'] } }, { releasePublishedAt: { exists: false } }, { or: [{ releaseAttempts: { exists: false } }, { releaseAttempts: { less_than: RELEASE_MAX_ATTEMPTS } }] }, ...extra] })

const retryAfter = (payload: Payload, tickets: Doc[], at: number, extra: Doc = {}) => Promise.all(tickets.map((t) => payload.update({ collection: 'tickets', id: t.id, data: { releaseRetryAt: new Date(at).toISOString(), ...extra }, ...o })))

/**
 * Publishes the Release for the Product's Tickets that were approved for production and have none yet. The deployed commit is the newest (by commit date) approved merge sha. Idempotent by the marker `<!-- bauherr:release:<sha> -->` in the release body: the release that shipped the sha is found before one is created. `notes-only` adds the notes to the release the Product's tooling made (waiting for it, then falling back to Ticket Comments); `factory` tags `v<semver>` itself and opens a CHANGELOG MR. The notes get one cheap-tier model pass (deterministic text on any failure) and are cached on the Tickets before the publish step so a retry does not re-run the model.
 */
export const publishRelease = async (payload: Payload, productId: number | string, now = Date.now()): Promise<{ state: 'none' | 'waiting' | 'published' | 'fallback'; url?: string }> => {
  const batch = (await payload.find({ collection: 'tickets', where: unreleased([{ product: { equals: productId } }]), sort: 'productionRequestedAt', limit: 200, pagination: false, ...o })).docs as Doc[]
  if (!batch.length) return { state: 'none' }
  const product = (await payload.findByID({ collection: 'products', id: productId, ...o })) as Doc
  if (product.releaseMode === 'manual') return { state: 'none' }
  const { backend, repo, tickets: ts } = await forgeOf(payload, productId)
  const forge = backend.forge
  const shas = [...new Set(batch.map((t) => t.productionApprovedSha as string))]
  const dates = await Promise.all(shas.map(async (s) => new Date(await forge.getCommitDate(repo, s)).getTime()))
  const sha = shas.reduce((best, s, i) => (dates[i]! >= dates[shas.indexOf(best)]! ? s : best))
  const marker = releaseMarker(sha)
  let release = await forge.findRelease(repo, { sha })
  const reused = !!release
  if (!release && product.releaseMode !== 'factory' && now - new Date(batch[0]!.productionRequestedAt).getTime() < RELEASE_WAIT_MS) {
    await retryAfter(payload, batch, now + RELEASE_POLL_MS)
    return { state: 'waiting' }
  }
  let notes = ''
  if (!release?.body.includes(marker)) {
    notes = batch[0]!.releaseNotes
    if (!notes || batch.some((t) => t.releaseNotes !== notes)) {
      const tpls = await noteTemplates(payload, id(product.workspace))
      const items = await Promise.all(batch.map(async (t) => collectItem({ number: t.number, title: t.title, url: t.url, labels: (await ts.get(String(t.number))).labels }, latestWith(await ts.listComments(String(t.number)), SUMMARY_MARKER)?.body ?? null, tpls.summary)))
      const deterministic = renderNotes(items, tpls.note)
      const ws = (await payload.findByID({ collection: 'workspaces', id: id(product.workspace), ...o })) as Doc
      notes = process.env.GATEWAY_URL ? await rewrite(deterministic, (system, user) => completeCheap(ws as Parameters<typeof completeCheap>[0], system, user)) : deterministic
      await Promise.all(batch.map((t) => payload.update({ collection: 'tickets', id: t.id, data: { releaseNotes: notes }, ...o })))
    }
  }
  const prerelease = product.releaseMode === 'factory' && !!product.releasePrerelease
  const done = new Date(now).toISOString()
  if (!release && product.releaseMode !== 'factory') {
    for (const t of batch) {
      await ts.comment(String(t.number), `Bauherr: no release found for \`${sha}\`, so the notes are posted here instead.\n\n${notes}`)
      await payload.update({ collection: 'tickets', id: t.id, data: { releasePublishedAt: done }, ...o })
    }
    return { state: 'fallback' }
  }
  if (!release) {
    const last = await forge.latestRelease(repo)
    const tag = `v${nextVersion(last?.tag ?? null, (await forge.listCommits(repo, { from: last?.sha, to: sha })).map((c) => c.message), prerelease ? await forge.listTags(repo) : undefined)}`
    release = await forge.createRelease(repo, { tag, sha, name: tag, body: `${notes}\n\n${marker}`, prerelease })
  } else if (notes) release = await forge.updateRelease(repo, release.id, { body: `${release.body.trimEnd()}\n\n## What's new\n\n${notes}\n\n${marker}` })
  if (product.releaseMode === 'factory' && !prerelease) await changelogPr(forge, repo, release, marker, now)
  const waits = prerelease && checkNames(product.releaseChecks).length > 0
  for (const t of batch) {
    if (!waits) await ts.comment(String(t.number), `Released in [${release.tag}](${release.url})`)
    await payload.update({ collection: 'tickets', id: t.id, data: { releaseUrl: release.url, releasePublishedAt: done, ...(waits && { releaseChecksSince: reused && release.createdAt && release.createdAt < done ? release.createdAt : done, releaseTag: release.tag, releaseSha: release.sha, releaseChecksState: 'waiting' }) }, ...o })
  }
  return { state: 'published', url: release.url }
}

/** Names in a comma-separated check list. */
const checkNames = (v: unknown): string[] => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean)
/** A pre-release whose release workflow has not finished after this long is `failed`. */
export const RELEASE_CHECKS_TIMEOUT_MS = 60 * 60_000

/**
 * Reads the Product's `releaseChecks` (for example `image, npm`) on the tagged sha for Tickets in `waiting` or `failed`, counting only runs that started at or after the window start (`releaseChecksSince`: the publish time, or the creation time of a reused older release so its own runs count; never the commit date GitHub reports for a new release) minus the clock-skew margin, and timing out 60 minutes after `releasePublishedAt`. All `success`: "Released in" and `passed` (also after a re-run of a failed workflow); a finished red check, or nothing after 60 minutes: `failed` with the run link (needs-you "Release failed", one Comment on the transition).
 */
export const watchReleaseChecks = async (payload: Payload, now = Date.now()): Promise<number> => {
  const tickets = (await payload.find({ collection: 'tickets', where: { releaseChecksState: { in: ['waiting', 'failed'] } }, limit: 200, pagination: false, ...o })).docs as Doc[]
  let changed = 0
  for (const t of tickets) {
    try {
      const { backend, repo, tickets: ts } = await forgeOf(payload, id(t.product))
      const product = (await payload.findByID({ collection: 'products', id: id(t.product), ...o })) as Doc
      const names = checkNames(product.releaseChecks)
      const published = new Date(t.releasePublishedAt).getTime()
      const since = new Date(t.releaseChecksSince ?? t.releasePublishedAt).getTime()
      const latest = latestChecks((await backend.forge.listChecks(repo, t.releaseSha)).filter((c) => c.startedAt && new Date(c.startedAt).getTime() >= since - CLOCK_SKEW_MS))
      await settleRetries(payload, t, t.releaseSha, latest)
      const picked = names.map((n) => latest.find((c) => c.name === n))
      const bad = picked.find((c) => c?.status === 'completed' && c.conclusion !== 'success')
      if (picked.every(succeeded)) {
        await payload.update({ collection: 'tickets', id: t.id, data: { releaseChecksState: 'passed', releaseRunUrl: null }, ...o })
        await ts.comment(String(t.number), `Released in [${t.releaseTag}](${t.releaseUrl})`)
        changed++
      } else if (failedCheck(bad) && t.releaseChecksState === 'waiting' && now - published <= RELEASE_CHECKS_TIMEOUT_MS && (await retryRed(payload, t, product, { backend, repo, tickets: ts }, t.releaseSha, [bad], latest)) === 'retried') continue
      else if ((bad || now - published > RELEASE_CHECKS_TIMEOUT_MS) && t.releaseChecksState === 'waiting') {
        const link = bad?.url ?? latest.find((c) => c.url)?.url ?? t.releaseUrl
        await payload.update({ collection: 'tickets', id: t.id, data: { releaseChecksState: 'failed', releaseRunUrl: link }, ...o })
        await ts.comment(String(t.number), `Bauherr: release [${t.releaseTag}](${t.releaseUrl}) ${bad ? `failed (${bad.name})` : 'did not finish within 60 minutes'}. ${link}`.trim())
        changed++
      }
    } catch (e) {
      payload.logger.error({ err: e, ticket: t.id }, 'watch-release-checks failed for ticket')
    }
  }
  return changed
}

/** Stores the error on the Product's pending Tickets and delays the next try by an hour; the 3rd failure gives up with a Comment. */
const recordFailure = async (payload: Payload, productId: number | string, e: unknown, now: number) => {
  const message = (e instanceof Error ? e.message : String(e)).slice(0, 500)
  const batch = (await payload.find({ collection: 'tickets', where: unreleased([{ product: { equals: productId } }]), limit: 200, pagination: false, ...o })).docs as Doc[]
  for (const t of batch) {
    const attempts = ((t.releaseAttempts as number | undefined) ?? 0) + 1
    await retryAfter(payload, [t], now + RELEASE_RETRY_MS, { releaseAttempts: attempts, releaseError: message })
    if (attempts >= RELEASE_MAX_ATTEMPTS) {
      const { tickets: ts } = await forgeOf(payload, productId)
      await ts.comment(String(t.number), `Bauherr: publishing the release failed ${attempts} times and is given up. Last error: ${message}`).catch((err) => payload.logger.error({ err, ticket: t.id }, 'release give-up comment failed'))
    }
  }
}

/** One `publishRelease` per Product with unreleased approved Tickets that are due for a try; one failing Product does not stop the others. */
export const publishReleases = async (payload: Payload, now = Date.now()): Promise<number> => {
  const due = { or: [{ releaseRetryAt: { exists: false } }, { releaseRetryAt: { less_than_equal: new Date(now).toISOString() } }] }
  const tickets = (await payload.find({ collection: 'tickets', where: unreleased([due]), limit: 1000, pagination: false, select: { product: true }, ...o })).docs as Doc[]
  let published = 0
  for (const product of new Set(tickets.map((t) => id(t.product)))) {
    try {
      if ((await publishRelease(payload, product, now)).state === 'published') published++
    } catch (e) {
      payload.logger.error({ err: e, product }, 'publish-release failed for product')
      await recordFailure(payload, product, e, now).catch((err) => payload.logger.error({ err, product }, 'recording release failure failed'))
    }
  }
  return published
}
