import type { Forge, TicketSource } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { latestWith } from '../app/(app)/lib/plan'
import { NotAdmin, NotInWorkspace } from './actions'
import { cas, changelogPr, forgeOf, id, releaseMarker } from './release'
import { workflowFor } from './factory'
import { nameOf } from './workflow'
import { completeCheap } from './gateway'
import { noteTemplates } from './templates'
import { renderNotes as renderItems, summarizeRelease } from './release-notes'
import { collectItems, mapLimit } from './release-items'
import { personOf } from './person'
import { SUMMARY_MARKER } from './summary'

type Doc = Record<string, any>
const o = { overrideAccess: true, depth: 0 } as const
const isDuplicate = (e: unknown): boolean => {
  for (let c: any = e; c; c = c.cause) if (c.code === '23505' || c.errors?.some((x: { message?: string }) => x.message === 'Value must be unique')) return true
  return false
}

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

export const waitingTickets = async (payload: Payload, product: number | string): Promise<Doc[]> => {
  const { lastReleaseAt, workspace } = (await payload.findByID({ collection: 'products', id: product, ...o })) as Doc
  const afterLastRelease = lastReleaseAt ? [{ or: [{ releaseAt: { exists: false } }, { releaseAt: { greater_than: lastReleaseAt } }] }] : []
  return (await payload.find({ collection: 'tickets', where: { and: [{ product: { equals: product } }, { stage: { equals: nameOf(workflowFor(workspace), 'done') } }, { releasedIn: { exists: false } }, { releaseUrl: { exists: false } }, { releasePublishedAt: { exists: false } }, { mergeSha: { exists: true } }, ...afterLastRelease] }, sort: 'number', limit: 500, pagination: false, ...o })).docs as Doc[]
}

const recordOldRelease = (payload: Payload, ticket: number | string, tag: string) =>
  payload.db.drizzle.execute(sql`UPDATE "tickets" SET "released_in" = ${tag} WHERE "id" = ${ticket} AND "released_in" IS NULL`)

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/
const parse = (tag: string) => { const m = SEMVER.exec(tag); return m && (m.slice(1).map((x) => (x === undefined ? 0 : Number(x))) as [number, number, number, number]) }
const order = (a: string, b: string) => { const [x, y] = [parse(a)!, parse(b)!]; return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || x[3] - y[3] }

export const releaseLine = (tags: string[]): { final: string | null; rc: string | null } => {
  const all = tags.filter((t) => /^v\d+\.\d+\.\d+(-rc\.\d+)?$/.test(t))
  const final = all.filter((t) => !t.includes('-rc.')).sort(order).at(-1) ?? null
  const rc = all.filter((t) => t.includes('-rc.') && !all.includes(t.replace(/-rc\.\d+$/, '')) && (!final || order(t.replace(/-rc\.\d+$/, ''), final) > 0)).sort(order).at(-1) ?? null
  return { final, rc }
}

export const versionChoices = (last: string | null): string[] => {
  const v = last && parse(last)
  if (!v) return ['0.1.0', '0.1.0-rc.1']
  const [major, minor, patch, rc] = v
  if (last!.includes('-rc.')) return [`${major}.${minor}.${patch}-rc.${rc + 1}`]
  const bumps = [`${major}.${minor}.${patch + 1}`, `${major}.${minor + 1}.0`, `${major + 1}.0.0`]
  return [...bumps.map((b) => `${b}-rc.1`), ...bumps]
}

export const proposeVersion = (last: string | null, tickets: { labels?: string[] | null }[]): string => {
  const v = last && parse(last)
  if (!v) return '0.1.0'
  const [major, minor, patch, rc] = v
  if (last!.includes('-rc.')) return `${major}.${minor}.${patch}-rc.${rc + 1}`
  const labels = tickets.flatMap((t) => t.labels ?? [])
  if (labels.includes('breaking')) return `${major + 1}.0.0-rc.1`
  if (labels.includes('type:feature')) return `${major}.${minor + 1}.0-rc.1`
  return `${major}.${minor}.${patch + 1}-rc.1`
}

export const renderNotes = async (payload: Payload, product: number | string, ts: TicketSource, tickets: Doc[], tpls?: Awaited<ReturnType<typeof noteTemplates>>): Promise<string> =>
  renderItems(await collectItems(payload, product, tickets, ts, tpls?.summary), tpls?.note)

const shippedMarker = (tag: string) => `<!-- bauherr:shipped:${tag} -->`

export const shipRelease = async (payload: Payload, user: Doc, a: { product: number | string; tickets: Doc[]; version: string; notes: string }): Promise<{ tag: string; url: string }> => {
  const tag = `v${a.version}`
  const { backend, repo, tickets: ts } = await forgeOf(payload, a.product)
  const forge = backend.forge
  const bad = a.tickets.find((t) => !t.mergeSha || (t.releasedIn && t.releasedIn !== tag))
  if (bad || !a.tickets.length) throw new Error(bad ? `Ticket #${bad.number} has no merge commit or is already in ${bad.releasedIn}` : 'no Tickets to ship')
  const rcN = /-rc\.(\d+)$/.exec(tag)?.[1]
  const line = tag.replace(/-rc\.\d+$/, '')
  const tags = await forge.listTags(repo)
  if (rcN && tags.includes(line)) throw new Error(`${line} already exists: the line is promoted, cut the next version`)
  if (!rcN && tags.some((t) => t.startsWith(`${tag}-rc.`))) throw new Error(`${tag} has release candidates: promote the newest one instead of cutting ${tag} again`)
  const prev = rcN && Number(rcN) > 1 ? `${line}-rc.${Number(rcN) - 1}` : null
  if (prev && !tags.includes(prev)) throw new Error(`${tag} needs ${prev} first`)
  let release = await forge.releaseByTag(repo, tag)
  let head = release?.sha ?? (tags.includes(tag) ? await forge.tagSha(repo, tag) ?? undefined : undefined)
  if (!head) {
    const dates = await Promise.all(a.tickets.map(async (t) => new Date(await forge.getCommitDate(repo, t.mergeSha)).getTime()))
    head = a.tickets[dates.indexOf(Math.max(...dates))]!.mergeSha as string
  }
  const contained = await mapLimit(a.tickets, (t) => forge.isAncestor(repo, t.mergeSha, head!))
  const stray = a.tickets.find((_, i) => !contained[i])
  if (stray) throw new Error(`Ticket #${stray.number} (${stray.mergeSha}) is not an ancestor of ${head}: it is not part of this release`)
  const prevSha = prev && (await forge.tagSha(repo, prev))
  if (prevSha && !(await forge.isAncestor(repo, prevSha, head!))) throw new Error(`${tag} would not contain ${prev} (${prevSha}): it cannot supersede it`)
  const first = a.tickets[0]!
  const touched = (await payload.find({ collection: 'human_touches', where: { and: [{ kind: { equals: 'ship:release' } }, { status: { equals: tag } }, { repo: { equals: repo } }] }, limit: 1, ...o })).totalDocs > 0
  if (!touched) await payload.create({ collection: 'human_touches', data: { kind: 'ship:release', ticket: first.id, workspace: id(first.workspace), actor: personOf(user), at: new Date().toISOString(), repo, status: tag }, ...o }).catch((e: unknown) => { if (!isDuplicate(e)) throw e })
  const marker = releaseMarker(head)
  release ??= await forge.createRelease(repo, { tag, sha: head, name: tag, body: `${prev ? `Supersedes ${prev}.\n\n` : ''}${a.notes}\n\n${marker}`, prerelease: !!rcN })
  const at = new Date().toISOString()
  const headAt = new Date(await forge.getCommitDate(repo, head)).toISOString()
  for (const t of a.tickets) {
    const n = String(t.number)
    if (!latestWith(await ts.listComments(n), shippedMarker(tag))) await ts.comment(n, `${shippedMarker(tag)}\nReleased in [${tag}](${release.url})`)
    await cas(payload, t.id, sql`"released_in" = ${tag}, "released_at" = ${at}`, sql`"released_at" IS NULL`)
  }
  const product = (await payload.findByID({ collection: 'products', id: a.product, ...o })) as Doc
  if (!product.lastReleaseAt || headAt > new Date(product.lastReleaseAt).toISOString()) await payload.update({ collection: 'products', id: a.product, data: { lastReleaseTag: tag, lastReleaseSha: head, lastReleaseAt: headAt }, ...o })
  if (!rcN) await changelogPr(forge, repo, release, marker, Date.now())
  return { tag, url: release.url }
}

export const promoteRelease = async (payload: Payload, user: Doc, a: { product: number | string; rc: string }): Promise<{ tag: string; url: string }> => {
  const m = /^(v\d+\.\d+\.\d+)-rc\.(\d+)$/.exec(a.rc)
  if (!m) throw new Error(`${a.rc} is not a release candidate (vX.Y.Z-rc.N)`)
  const final = m[1]!
  const { backend, repo, tickets: ts } = await forgeOf(payload, a.product)
  const forge = backend.forge
  const tags = await forge.listTags(repo)
  const newest = tags.filter((t) => t.startsWith(`${final}-rc.`) && /-rc\.\d+$/.test(t)).sort(order).at(-1)
  if (newest !== a.rc) throw new Error(`${a.rc} is not the newest release candidate of ${final}${newest ? ` (${newest})` : ''}`)
  const sha = await forge.tagSha(repo, a.rc)
  if (!sha) throw new Error(`tag ${a.rc} does not exist`)
  const finalSha = await forge.tagSha(repo, final)
  if (finalSha && finalSha !== sha) throw new Error(`${final} already exists on another commit than ${a.rc}`)
  const inLine = (t: Doc) => typeof t.releasedIn === 'string' && t.releasedIn.startsWith(`${final}-rc.`) && /^-rc\.\d+$/.test(t.releasedIn.slice(final.length))
  const tickets = ((await payload.find({ collection: 'tickets', where: { and: [{ product: { equals: a.product } }, { releasedIn: { contains: `${final}-rc.` } }] }, sort: 'number', pagination: false, ...o })).docs as Doc[]).filter(inLine)
  const first = tickets[0]
  if (first && !(await payload.find({ collection: 'human_touches', where: { and: [{ kind: { equals: 'ship:release' } }, { status: { equals: final } }, { repo: { equals: repo } }] }, limit: 1, ...o })).totalDocs) await payload.create({ collection: 'human_touches', data: { kind: 'ship:release', ticket: first.id, workspace: id(first.workspace), actor: personOf(user), at: new Date().toISOString(), repo, status: final }, ...o }).catch((e: unknown) => { if (!isDuplicate(e)) throw e })
  const marker = releaseMarker(sha)
  let release = await forge.releaseByTag(repo, final)
  if (!release) {
    const notes = tickets.length ? await renderNotes(payload, a.product, ts, tickets, await noteTemplates(payload, id(first!.workspace))) : ''
    release = await forge.createRelease(repo, { tag: final, sha, name: final, body: `Promoted from ${a.rc} (commit ${sha.slice(0, 7)}).\n\n${notes}${notes ? '\n\n' : ''}${marker}`, prerelease: false })
  }
  for (const t of tickets) {
    const n = String(t.number)
    if (!latestWith(await ts.listComments(n), shippedMarker(final))) await ts.comment(n, `${shippedMarker(final)}\nReleased in [${final}](${release.url}) (tested as ${a.rc})`)
    await payload.db.drizzle.execute(sql`UPDATE "tickets" SET "released_in" = ${final}, "updated_at" = now() WHERE "id" = ${t.id} AND "released_in" IS DISTINCT FROM ${final}`)
  }
  const headAt = new Date(await forge.getCommitDate(repo, sha)).toISOString()
  const product = (await payload.findByID({ collection: 'products', id: a.product, ...o })) as Doc
  if (!product.lastReleaseAt || headAt >= new Date(product.lastReleaseAt).toISOString()) await payload.update({ collection: 'products', id: a.product, data: { lastReleaseTag: final, lastReleaseSha: sha, lastReleaseAt: headAt }, ...o })
  await changelogPr(forge, repo, release, marker, Date.now())
  return { tag: final, url: release.url }
}

const unfinishedPromotion = async (payload: Payload, forge: Forge, repo: string, product: number | string, tags: string[], finalTag: string | null): Promise<string | null> => {
  if (!finalTag) return null
  const rc = tags.filter((t) => t.startsWith(`${finalTag}-rc.`) && /-rc\.\d+$/.test(t)).sort(order).at(-1)
  if (!rc || (await forge.tagSha(repo, finalTag)) !== (await forge.tagSha(repo, rc))) return null
  const left = (await payload.find({ collection: 'tickets', where: { and: [{ product: { equals: product } }, { releasedIn: { contains: `${finalTag}-rc.` } }] }, limit: 1, ...o })).totalDocs > 0
  const done = !left && !!(await forge.releaseByTag(repo, finalTag)) && (await forge.listPullRequests(repo, 'all', `bauherr/release-${finalTag}`)).some((p) => p.head === `bauherr/release-${finalTag}`)
  return done ? null : rc
}

export const releaseDraft = async (payload: Payload, product: number | string, ids?: (number | string)[], withPast = true, lastTag?: string | null) => {
  const { backend, repo, tickets: ts } = await forgeOf(payload, product)
  const past = withPast ? await backend.forge.listReleases(repo) : []
  const tags = withPast ? await backend.forge.listTags(repo) : []
  const line = releaseLine(tags)
  const latest = past[0]
  let p = (await payload.findByID({ collection: 'products', id: product, ...o })) as Doc
  let waiting = await waitingTickets(payload, product)
  if (latest) {
    const released = await mapLimit(waiting, (t) => inRelease(repo, t.mergeSha, latest.sha, () => backend.forge.isAncestor(repo, t.mergeSha, latest.sha)))
    for (const [i, t] of waiting.entries()) if (released[i]) await recordOldRelease(payload, t.id, latest.tag)
    waiting = waiting.filter((_, i) => !released[i])
  }
  if (latest && !p.lastReleaseAt) p = await payload.update({ collection: 'products', id: product, data: { lastReleaseTag: latest.tag, lastReleaseSha: latest.sha, lastReleaseAt: new Date(await backend.forge.getCommitDate(repo, latest.sha)).toISOString() }, ...o }) as Doc
  const picked = ids ? waiting.filter((t) => ids.map(String).includes(String(t.id))) : waiting
  const notes = picked.length ? await renderNotes(payload, product, ts, picked, await noteTemplates(payload, id(p.workspace))) : ''
  const last = lastTag !== undefined ? lastTag : line.rc ?? line.final ?? latest?.tag ?? p.lastReleaseTag ?? null
  const rc = line.rc ?? (withPast ? await unfinishedPromotion(payload, backend.forge, repo, product, tags, line.final) : null)
  const rcTickets = rc ? ((await payload.find({ collection: 'tickets', where: { and: [{ product: { equals: product } }, { releasedIn: { contains: `${rc.replace(/-rc\.\d+$/, '')}-rc.` } }] }, sort: 'number', pagination: false, ...o })).docs as Doc[]) : []
  return { waiting, picked, last, version: proposeVersion(last, picked), versions: versionChoices(last), notes, past, rc, finishing: !line.rc && !!rc, rcTickets }
}

export const promoteSelected = async (payload: Payload, user: Doc, a: { workspaceId: number | string; product: number | string; rc: string }): Promise<{ tag: string; url: string }> => {
  if (user.role !== 'admin') throw new NotAdmin()
  await productIn(payload, a.product, a.workspaceId)
  return promoteRelease(payload, user, a)
}

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

export const shipSelected = async (payload: Payload, user: Doc, a: { workspaceId: number | string; product: number | string; ids: (number | string)[]; version: string; notes: string; summary?: string }): Promise<{ tag: string; url: string }> => {
  if (user.role !== 'admin') throw new NotAdmin()
  await productIn(payload, a.product, a.workspaceId)
  if (!/^\d+\.\d+\.\d+(-rc\.\d+)?$/.test(a.version)) throw new Error('The version must look like 0.2.0 or 0.2.0-rc.1')
  const ids = a.ids.map(String)
  const tickets = (await waitingTickets(payload, a.product)).filter((t) => ids.includes(String(t.id)))
  if (tickets.length !== new Set(ids).size) throw new Error('A selected Ticket is no longer waiting for a release; reload the page')
  return shipRelease(payload, user, { product: a.product, tickets, version: a.version, notes: a.summary?.trim() ? `${a.summary.trim()}\n\n${a.notes}` : a.notes })
}

export const releaseReminder = (product: { releaseMode?: string | null; releaseReminderDays?: number | null }, waiting: { productionRequestedAt?: string | null; releaseAt?: string | null; updatedAt: string }[], now = Date.now()): { count: number; days: number } | null => {
  if (product.releaseMode !== 'manual' || !waiting.length) return null
  const since = Math.min(...waiting.map((t) => Date.parse(t.productionRequestedAt ?? t.releaseAt ?? t.updatedAt)))
  const days = Math.floor((now - since) / 86_400_000)
  return days > (product.releaseReminderDays ?? 7) ? { count: waiting.length, days } : null
}

export const releaseReminders = async (payload: Payload, workspaceId: number | string): Promise<{ product: { id: number; name: string }; count: number; days: number }[]> => {
  const products = (await payload.find({ collection: 'products', where: { and: [{ workspace: { equals: workspaceId } }, { releaseMode: { equals: 'manual' } }] }, pagination: false, ...o })).docs as Doc[]
  const out = await Promise.all(products.map(async (p) => {
    const r = releaseReminder(p, (await waitingTickets(payload, p.id).catch(() => [])) as { updatedAt: string }[])
    return r && { product: { id: p.id as number, name: p.name as string }, ...r }
  }))
  return out.filter((r) => r !== null)
}
