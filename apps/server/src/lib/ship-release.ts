import type { TicketSource } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { latestWith } from '../app/(app)/lib/plan'
import { NotAdmin, NotInWorkspace } from './actions'
import { cas, changelogPr, forgeOf, id, releaseMarker } from './release'
import { completeCheap } from './gateway'
import { collectItem, renderNotes as renderItems, summarizeRelease } from './release-notes'
import { personOf } from './person'
import { SUMMARY_MARKER } from './summary'

type Doc = Record<string, any>
const o = { overrideAccess: true, depth: 0 } as const
/** Postgres unique violation (23505), also when wrapped by the ORM or reported by Payload as "Value must be unique". */
const isDuplicate = (e: unknown): boolean => {
  for (let c: any = e; c; c = c.cause) if (c.code === '23505' || c.errors?.some((x: { message?: string }) => x.message === 'Value must be unique')) return true
  return false
}

/** Whether a merge commit is in a release, per (repo, merge sha, release sha): the answer never changes. LRU of 500 entries. */
const LRU = 500
const ancestry = new Map<string, boolean>()
const inRelease = async (repo: string, sha: string, release: string, ask: () => Promise<boolean>): Promise<boolean> => {
  const key = `${repo}:${sha}:${release}`
  let answer = ancestry.get(key)
  if (answer === undefined) answer = await ask()
  ancestry.delete(key)
  ancestry.set(key, answer)
  if (ancestry.size > LRU) ancestry.delete(ancestry.keys().next().value!)
  return answer
}

/** `fn` over `items` with at most 4 in flight, so the forge's secondary rate limit is not tripped. */
const mapLimit = async <T, R>(items: T[], fn: (x: T) => Promise<R>): Promise<R[]> => {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]!) } }))
  return out
}

/** Tickets of the Product that are done, have a merge commit and are in no release yet, oldest first. Database fields only (no forge call): Tickets released by the notes-only/factory path, or merged before the Product's `lastReleaseAt`, are not waiting. */
export const waitingTickets = async (payload: Payload, product: number | string): Promise<Doc[]> => {
  const [docs, p] = await Promise.all([
    payload.find({ collection: 'tickets', where: { and: [{ product: { equals: product } }, { stage: { equals: 'done' } }, { releasedIn: { exists: false } }, { releaseUrl: { exists: false } }, { releasePublishedAt: { exists: false } }, { mergeSha: { exists: true } }] }, sort: 'number', limit: 500, pagination: false, ...o }).then((r) => r.docs as Doc[]),
    payload.findByID({ collection: 'products', id: product, ...o }) as Promise<Doc>,
  ])
  const since = p.lastReleaseAt ? Date.parse(p.lastReleaseAt) : null
  return docs.filter((t) => !!t.mergeSha && (since === null || Date.parse(t.releaseAt ?? t.updatedAt) > since))
}

/** Versions offered for the next release: patch, minor, major from the last stable version, plus the next rc when the last release is an rc. No previous release = 0.1.0. */
export const versionChoices = (last: string | null): string[] => {
  const m = last && /^v?(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/.exec(last)
  if (!m) return ['0.1.0']
  const [major, minor, patch] = m.slice(1, 4).map(Number) as [number, number, number]
  return [...(m[4] ? [`${major}.${minor}.${patch}-rc.${Number(m[4]) + 1}`] : []), `${major}.${minor}.${patch + 1}`, `${major}.${minor + 1}.0`, `${major + 1}.0.0`]
}

/** Next version (no `v`) from the last release tag: while that is an rc the rc number goes up; else any `breaking` label = major, any `type:feature` = minor, else patch; no previous release = 0.1.0. */
export const proposeVersion = (last: string | null, tickets: { labels?: string[] | null }[]): string => {
  const m = last && /^v?(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/.exec(last)
  if (!m) return '0.1.0'
  const [major, minor, patch] = m.slice(1, 4).map(Number) as [number, number, number]
  if (m[4]) return `${major}.${minor}.${patch}-rc.${Number(m[4]) + 1}`
  const labels = tickets.flatMap((t) => t.labels ?? [])
  if (labels.includes('breaking')) return `${major + 1}.0.0`
  if (labels.includes('type:feature')) return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

/** Deterministic notes (Features, Fixes) of the Tickets from their staging summaries. */
export const renderNotes = async (ts: TicketSource, tickets: Doc[]): Promise<string> =>
  renderItems(await Promise.all(tickets.map(async (t) => collectItem({ number: t.number, title: t.title, url: t.url, labels: t.labels ?? [] }, latestWith(await ts.listComments(String(t.number)), SUMMARY_MARKER)?.body ?? null))))

const shippedMarker = (tag: string) => `<!-- bauherr:shipped:${tag} -->`

/**
 * Ships the selected Tickets as release `v<version>`: every merge commit must be an ancestor of the newest one (else refused naming the Ticket), then the human touch `ship:release`, tag and forge release, the comment and `releasedIn`/`releasedAt` per Ticket, and the CHANGELOG MR (stable versions). Every step looks before it writes (release by tag, comment by marker, touch by tag, MR by branch), so a retry after an error finishes what is left and creates no second tag or release.
 */
export const shipRelease = async (payload: Payload, user: Doc, a: { product: number | string; tickets: Doc[]; version: string; notes: string }): Promise<{ tag: string; url: string }> => {
  const tag = `v${a.version}`
  const { backend, repo, tickets: ts } = await forgeOf(payload, a.product)
  const forge = backend.forge
  const bad = a.tickets.find((t) => !t.mergeSha || (t.releasedIn && t.releasedIn !== tag))
  if (bad || !a.tickets.length) throw new Error(bad ? `Ticket #${bad.number} has no merge commit or is already in ${bad.releasedIn}` : 'no Tickets to ship')
  let release = await forge.releaseByTag(repo, tag)
  let head = release?.sha
  if (!head) {
    const dates = await Promise.all(a.tickets.map(async (t) => new Date(await forge.getCommitDate(repo, t.mergeSha)).getTime()))
    head = a.tickets[dates.indexOf(Math.max(...dates))]!.mergeSha as string
  }
  const contained = await mapLimit(a.tickets, (t) => forge.isAncestor(repo, t.mergeSha, head!))
  const stray = a.tickets.find((_, i) => !contained[i])
  if (stray) throw new Error(`Ticket #${stray.number} (${stray.mergeSha}) is not an ancestor of ${head}: it is not part of this release`)
  const first = a.tickets[0]!
  const touched = (await payload.find({ collection: 'human_touches', where: { and: [{ kind: { equals: 'ship:release' } }, { status: { equals: tag } }, { repo: { equals: repo } }] }, limit: 1, ...o })).totalDocs > 0
  if (!touched) await payload.create({ collection: 'human_touches', data: { kind: 'ship:release', ticket: first.id, workspace: id(first.workspace), actor: personOf(user), at: new Date().toISOString(), repo, status: tag }, ...o }).catch((e: unknown) => { if (!isDuplicate(e)) throw e })
  const marker = releaseMarker(head)
  release ??= await forge.createRelease(repo, { tag, sha: head, name: tag, body: `${a.notes}\n\n${marker}`, prerelease: a.version.includes('-rc.') })
  const at = new Date().toISOString()
  const headAt = new Date(await forge.getCommitDate(repo, head)).toISOString()
  const product = (await payload.findByID({ collection: 'products', id: a.product, ...o })) as Doc
  if (!product.lastReleaseAt || headAt > new Date(product.lastReleaseAt).toISOString()) await payload.update({ collection: 'products', id: a.product, data: { lastReleaseTag: tag, lastReleaseSha: head, lastReleaseAt: headAt }, ...o })
  for (const t of a.tickets) {
    const n = String(t.number)
    if (!latestWith(await ts.listComments(n), shippedMarker(tag))) await ts.comment(n, `${shippedMarker(tag)}\nReleased in [${tag}](${release.url})`)
    await cas(payload, t.id, sql`"released_in" = ${tag}, "released_at" = ${at}`, sql`"released_at" IS NULL`)
  }
  if (!a.version.includes('-rc.')) await changelogPr(forge, repo, release, marker, Date.now())
  return { tag, url: release.url }
}

/**
 * The Releases page data of a Product: Tickets waiting, the `picked` ones (all, or those in `ids`), the proposed version and notes for them, and the forge's releases (newest first, only with `withPast`).
 * With `withPast` (the page opened on purpose) it asks the forge for the releases, backfills `lastRelease*` once, and drops Tickets whose merge is already in the latest release (ancestry, 4 at a time). Without it nothing but the Ticket comments is read from the forge.
 */
export const releaseDraft = async (payload: Payload, product: number | string, ids?: (number | string)[], withPast = true) => {
  const { backend, repo, tickets: ts } = await forgeOf(payload, product)
  const past = withPast ? await backend.forge.listReleases(repo) : []
  const latest = past[0]
  let p = (await payload.findByID({ collection: 'products', id: product, ...o })) as Doc
  if (latest && !p.lastReleaseAt) p = await payload.update({ collection: 'products', id: product, data: { lastReleaseTag: latest.tag, lastReleaseSha: latest.sha, lastReleaseAt: new Date(latest.createdAt ?? (await backend.forge.getCommitDate(repo, latest.sha))).toISOString() }, ...o }) as Doc
  let waiting = await waitingTickets(payload, product)
  if (latest) {
    const released = await mapLimit(waiting, (t) => inRelease(repo, t.mergeSha, latest.sha, () => backend.forge.isAncestor(repo, t.mergeSha, latest.sha)))
    waiting = waiting.filter((_, i) => !released[i])
  }
  const picked = ids ? waiting.filter((t) => ids.map(String).includes(String(t.id))) : waiting
  const notes = picked.length ? await renderNotes(ts, picked) : ''
  const last = latest?.tag ?? p.lastReleaseTag ?? null
  return { waiting, picked, version: proposeVersion(last, picked), versions: versionChoices(last), notes, past }
}

/** The model-written summary over the notes of the Tickets `ids`, on request only (the Summarise button); empty without a gateway or on any model error. */
export const releaseSummary = async (payload: Payload, product: number | string, ids: (number | string)[]): Promise<string> => {
  if (!process.env.GATEWAY_URL) return ''
  const { picked, notes } = await releaseDraft(payload, product, ids, false)
  if (!picked.length) return ''
  const ws = (await payload.findByID({ collection: 'workspaces', id: id((await payload.findByID({ collection: 'products', id: product, ...o })).workspace), ...o })) as Doc
  return summarizeRelease(notes, (system, user) => completeCheap(ws as Parameters<typeof completeCheap>[0], system, user))
}

const productIn = async (payload: Payload, product: number | string, workspaceId: number | string) => {
  if (!(await payload.find({ collection: 'products', where: { and: [{ id: { equals: product } }, { workspace: { equals: workspaceId } }] }, limit: 1, ...o })).totalDocs) throw new NotInWorkspace()
}

/** Admin-only: ships the Tickets `ids` (each must be waiting for a release) of a Product of the Workspace as `version`. */
export const shipSelected = async (payload: Payload, user: Doc, a: { workspaceId: number | string; product: number | string; ids: (number | string)[]; version: string; notes: string; summary?: string }): Promise<{ tag: string; url: string }> => {
  if (user.role !== 'admin') throw new NotAdmin()
  await productIn(payload, a.product, a.workspaceId)
  if (!/^\d+\.\d+\.\d+(-rc\.\d+)?$/.test(a.version)) throw new Error('The version must look like 0.2.0 or 0.2.0-rc.1')
  const ids = a.ids.map(String)
  const tickets = (await waitingTickets(payload, a.product)).filter((t) => ids.includes(String(t.id)))
  if (tickets.length !== new Set(ids).size) throw new Error('A selected Ticket is no longer waiting for a release; reload the page')
  return shipRelease(payload, user, { product: a.product, tickets, version: a.version, notes: a.summary?.trim() ? `${a.summary.trim()}\n\n${a.notes}` : a.notes })
}

/** The owner's reminder (manual Product only): done Tickets have waited longer than `releaseReminderDays` (default 7) for a release. Null when nothing is due. Computed on every Board load, so it needs no stored state and posts no Comment. */
export const releaseReminder = (product: { releaseMode?: string | null; releaseReminderDays?: number | null }, waiting: { productionRequestedAt?: string | null; releaseAt?: string | null; updatedAt: string }[], now = Date.now()): { count: number; days: number } | null => {
  if (product.releaseMode !== 'manual' || !waiting.length) return null
  const since = Math.min(...waiting.map((t) => Date.parse(t.productionRequestedAt ?? t.releaseAt ?? t.updatedAt)))
  const days = Math.floor((now - since) / 86_400_000)
  return days > (product.releaseReminderDays ?? 7) ? { count: waiting.length, days } : null
}

/** Reminders for the Workspace's manual Products, for the Board. */
export const releaseReminders = async (payload: Payload, workspaceId: number | string): Promise<{ product: { id: number; name: string }; count: number; days: number }[]> => {
  const products = (await payload.find({ collection: 'products', where: { and: [{ workspace: { equals: workspaceId } }, { releaseMode: { equals: 'manual' } }] }, pagination: false, ...o })).docs as Doc[]
  const out = await Promise.all(products.map(async (p) => {
    const r = releaseReminder(p, (await waitingTickets(payload, p.id).catch(() => [])) as { updatedAt: string }[])
    return r && { product: { id: p.id as number, name: p.name as string }, ...r }
  }))
  return out.filter((r) => r !== null)
}
