import type { Comment, TicketSource } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { DECISIONS_MARKER, formatDecision, parseAnswers, parseDecisions, sheetOf, type Decision } from '../app/(app)/lib/plan'
import { askedOf, needBy } from './addressee'
import { workflowFor } from './factory'
import { productOwnersOfTicket, tenantIds } from './people'
import { id } from './release'
import { checkpointBy, is } from './workflow'
import type { Addressee } from './workflow-rules'

/**
 * The forge as a channel (spec people.md, "Forge channel"): a gate label or an answers comment counts only when its author's forge login is linked to a Bauherr or Admin of the Workspace,
 * or to a Product owner assigned to the Ticket's Product where the checkpoint (for answers: the row) asks the Product owner. The account's `githubLogin` holds the login (a GitLab username as well).
 */
type Doc = Record<string, any>
const o = { overrideAccess: true, depth: 0 } as const

export const logins = (v: unknown): string[] => String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean)

/** Bauherren and Admins of the Workspace with a linked login (Admins are not tenant-scoped: they see every Workspace). */
const bauherrDocsOf = async (payload: Payload, workspace: unknown): Promise<Doc[]> => {
  const ws = id(workspace)
  const { docs } = await payload.find({ collection: 'bauherren', where: { and: [{ role: { in: ['admin', 'bauherr'] } }, { githubLogin: { exists: true } }] }, pagination: false, ...o })
  return (docs as Doc[]).filter((a) => a.role === 'admin' || (ws !== undefined && tenantIds(a).includes(Number(ws))))
}

/** The linked forge logins of the Workspace's Bauherren and Admins, as written on the account: who is assigned and mentioned at a gate. */
export const gateOwnersOf = async (payload: Payload, workspace: unknown): Promise<string[]> => (await bauherrDocsOf(payload, workspace)).flatMap((a) => logins(a.githubLogin))

const lower = (l: string[]) => new Set(l.map((x) => x.toLowerCase()))

export interface Voices {
  /** Lower-cased logins of the Workspace's Bauherren and Admins. */
  bauherren: Set<string>
  /** Lower-cased logins of the Product owners assigned to the Ticket's Product. */
  owners: Set<string>
  /** Whether a Product owner is assigned to the Product at all (a checkpoint for them is the Bauherr's otherwise). */
  ownerAssigned: boolean
}

export const voicesOf = async (payload: Payload, t: Doc): Promise<Voices> => {
  const owners = await productOwnersOfTicket(payload, t)
  return { bauherren: lower(await gateOwnersOf(payload, t.workspace)), owners: lower(owners.flatMap((u) => logins(u.githubLogin))), ownerAssigned: owners.length > 0 }
}

/** Who a forge login speaks for on this Ticket: a Bauherr or Admin, a Product owner of the Product, or nobody. Matching ignores case. */
export const speaksAs = (v: Voices, login: string): Addressee | null => (v.bauherren.has(login.toLowerCase()) ? 'bauherr' : v.owners.has(login.toLowerCase()) ? 'product-owner' : null)

/** What a gate asks for the Ticket in fact (a checkpoint for the Product owner of a Product without one asks the Bauherr). */
export const askedFor = (t: Doc, need: string, v: Voices): Addressee => askedOf(needBy(workflowFor(t.workspace), need, t.stage), v.ownerAssigned)

const ME_TTL_MS = 5 * 60_000
const ME = new Map<string, { at: number; login: string | null }>()
/** Test hook: forget the cached factory login. */
export const forgetFactoryLogin = () => ME.clear()

/** The login of the factory's own forge credential (null for an App token: its comments carry a `[bot]` author), cached per Connection for 5 minutes. Throws when the forge cannot say. */
export const factoryLoginOf = async (payload: Payload, t: Doc, ts: TicketSource): Promise<string | null> => {
  const src = (await payload.find({ collection: 'ticket_sources', where: { product: { equals: id(t.product) } }, limit: 1, ...o })).docs[0] as Doc | undefined
  const key = String(id(src?.connection) ?? `product:${id(t.product)}`)
  const hit = ME.get(key)
  if (hit && Date.now() - hit.at < ME_TTL_MS) return hit.login
  const login = await ts.whoami()
  ME.set(key, { at: Date.now(), login })
  return login
}

/** Whether a forge author is the factory's own credential: what the UI, chat and MCP paths write under. The forge sets the author from the credential, never from the text. */
export const isFactoryAuthor = (author: string, me: string | null): boolean => (me === null ? author.endsWith('[bot]') : author.toLowerCase() === me.toLowerCase())

export interface Ignored {
  comment: Comment
  /** Answer rows of the Comment that do not count (`[]` when the whole Comment is ignored because of its author). */
  rows: string[]
}

type Vetted = { comments: Comment[]; ignored: Ignored[] }

/** The part of a Product owner's answers Comment that counts: answers and added rows addressed to the Product owner; null when nothing is left. */
const ownerPart = (c: Comment, sheetRows: Decision[], by: Addressee): { comment: Comment | null; dropped: string[] } => {
  const added = parseDecisions(c.body)
  const rows = [...sheetRows, ...added]
  const ok = (d: Decision | undefined) => !!d && (d.for ?? by) === 'product-owner'
  const answers = Object.entries(parseAnswers(c.body))
  const kept = answers.filter(([k]) => ok(rows.find((d) => d.id === k)))
  const keptAdded = added.filter(ok)
  const dropped = [...answers.filter(([k]) => !kept.some(([x]) => x === k)).map(([k]) => k), ...added.filter((d) => !ok(d)).map((d) => d.id)]
  const body = `${DECISIONS_MARKER}\n${kept.map(([k, v]) => `${k}: ${v}`).join('\n')}${keptAdded.length ? `\n\n## Decisions\n${keptAdded.map(formatDecision).join('\n')}` : ''}`
  return { comment: kept.length || keptAdded.length ? { ...c, body } : null, dropped }
}

/**
 * The comments with the untrusted answers Comments taken out (pure): the factory's own, a Bauherr's or an Admin's stay as written; a Product owner's keep only the rows that ask the Product owner
 * (`for:`, else the checkpoint's `by`); anyone else's go. Everything else stays in order.
 */
export const vetAnswers = (comments: Comment[], me: string | null, v: Voices, by: Addressee): Vetted => {
  const sheet = sheetOf(comments)
  const sheetRows = sheet ? parseDecisions(sheet.body) : []
  const out: Comment[] = []
  const ignored: Ignored[] = []
  for (const c of comments) {
    if (!c.body.startsWith(DECISIONS_MARKER) || isFactoryAuthor(c.author, me)) {
      out.push(c)
      continue
    }
    const as = speaksAs(v, c.author)
    if (as === 'bauherr') out.push(c)
    else if (as === 'product-owner') {
      const { comment, dropped } = ownerPart(c, sheetRows, by)
      if (comment) out.push(comment)
      if (dropped.length || !comment) ignored.push({ comment: c, rows: dropped })
    } else ignored.push({ comment: c, rows: [] })
  }
  return { comments: out, ignored }
}

export const IGNORED_MARKER = (commentId: string) => `<!-- bauherr:answers-ignored:${commentId} -->`

const noteIgnored = async (payload: Payload, t: Doc, ts: TicketSource, all: Comment[], ignored: Ignored[]): Promise<void> => {
  for (const { comment, rows } of ignored) {
    const marker = IGNORED_MARKER(comment.id)
    if (all.some((c) => c.body.startsWith(marker))) continue
    const why = rows.length
      ? `only rows addressed to the Product owner count from @${comment.author}; ${rows.join(', ')} ${rows.length === 1 ? 'is' : 'are'} the Bauherr's to answer.`
      : `@${comment.author} is not linked to a Bauherr, an Admin or a Product owner of this Product. Answer on the Ticket page, or link your login on your profile.`
    try {
      await ts.comment(String(t.number), `${marker}\nBauherr ignored ${rows.length ? 'part of ' : ''}the decisions Comment: ${why}`)
    } catch (e) {
      payload.logger.warn({ err: e, ticket: t.id }, 'ignored answers not explained')
    }
  }
}

/**
 * The Ticket's forge comments as decisions are read from them: the answers Comments that do not count are left out, so `answersOf`, `openCritical` and every page see only what counts.
 * `notify` also explains each ignored Comment once on the forge (marker per Comment); only the sweeps and the poller pass it, so a page render never writes.
 * No answers Comment: the plain list, with no further read.
 */
export const decisionComments = async (payload: Payload, t: Doc, ts: TicketSource, opts: { notify?: boolean } = {}): Promise<Comment[]> => {
  const all = await ts.listComments(String(t.number))
  if (!all.some((c) => c.body.startsWith(DECISIONS_MARKER))) return all
  const wf = workflowFor(t.workspace)
  const by = checkpointBy(wf, is(wf, t.stage ?? '', 'plan') ? 'plan' : 'refine')
  const { comments, ignored } = vetAnswers(all, await factoryLoginOf(payload, t, ts), await voicesOf(payload, t), by)
  if (opts.notify && ignored.length) await noteIgnored(payload, t, ts, all, ignored)
  return comments
}
