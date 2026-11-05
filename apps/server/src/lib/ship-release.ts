import type { TicketSource } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { latestWith } from '../app/(app)/lib/plan'
import { changelogPr, forgeOf, id, releaseMarker } from './release'
import { collectItem, renderNotes as renderItems } from './release-notes'
import { personOf } from './person'
import { SUMMARY_MARKER } from './summary'

type Doc = Record<string, any>
const o = { overrideAccess: true, depth: 0 } as const

/** Tickets of the Product that are done and in no release yet, oldest first. */
export const waitingTickets = async (payload: Payload, product: number | string): Promise<Doc[]> =>
  (await payload.find({ collection: 'tickets', where: { and: [{ product: { equals: product } }, { stage: { equals: 'done' } }, { releasedIn: { exists: false } }] }, sort: 'number', limit: 500, pagination: false, ...o })).docs as Doc[]

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
  let release = (await forge.listReleases(repo)).find((r) => r.tag === tag) ?? null
  let head = release?.sha
  if (!head) {
    const dates = await Promise.all(a.tickets.map(async (t) => new Date(await forge.getCommitDate(repo, t.mergeSha)).getTime()))
    head = a.tickets[dates.indexOf(Math.max(...dates))]!.mergeSha as string
  }
  for (const t of a.tickets) if (!(await forge.isAncestor(repo, t.mergeSha, head))) throw new Error(`Ticket #${t.number} (${t.mergeSha}) is not an ancestor of ${head}: it is not part of this release`)
  const first = a.tickets[0]!
  const touched = (await payload.find({ collection: 'human_touches', where: { and: [{ kind: { equals: 'ship:release' } }, { status: { equals: tag } }, { repo: { equals: repo } }] }, limit: 1, ...o })).totalDocs > 0
  if (!touched) await payload.create({ collection: 'human_touches', data: { kind: 'ship:release', ticket: first.id, workspace: id(first.workspace), actor: personOf(user), at: new Date().toISOString(), repo, status: tag }, ...o })
  const marker = releaseMarker(head)
  release ??= await forge.createRelease(repo, { tag, sha: head, name: tag, body: `${a.notes}\n\n${marker}`, prerelease: a.version.includes('-rc.') })
  const at = new Date().toISOString()
  for (const t of a.tickets) {
    const n = String(t.number)
    if (!latestWith(await ts.listComments(n), shippedMarker(tag))) await ts.comment(n, `${shippedMarker(tag)}\nReleased in [${tag}](${release.url})`)
    if (!t.releasedIn) await payload.update({ collection: 'tickets', id: t.id, data: { releasedIn: tag, releasedAt: at }, ...o })
  }
  if (!a.version.includes('-rc.')) await changelogPr(forge, repo, release, marker, Date.now())
  return { tag, url: release.url }
}
