import { type Checkpoint, CHECKPOINTS, type Decision, PROOF_NEEDS, buildDecision, canDecide, humanStage, isNeed, urgentReasons } from '../../../lib/decision'
import { SKILL_NEED } from '../../../lib/checkpoints'
import { isProductOwner, productScope, productsVisibleTo } from '../../../lib/people'
import { unseenOf } from '../../../lib/inbox-seen'
import { asksOwner } from '../../../lib/addressee'
import { payloadClient } from './session'
import { renderMarkdown } from './markdown'
import { waited } from './format'
import type { ApprovalBrief } from './brief'
import { loadProof, type ProofData } from './proof'

type Doc = Record<string, any>
const BRIEF_NEEDS = ['Accept on staging', 'Approve production']

/** One card of the Inbox, as the client component needs it. */
export type InboxItem = { id: number; number: number; product: { id: number; name: string }; decision: Decision; detailsHtml: string | null; waiting: string; /** The Ticket is on the fast lane (`expedite`). */ fastLane?: boolean; /** Open longer than 24 h. */ overdue?: boolean; /** Set for a Bauherr when the card asks the Product owner (a Bauherr may step in). */ asked?: 'product-owner'; /** The proof table of a decision that accepts or approves a result. */ proof?: ProofData; /** The frozen approval brief of the same decisions. */ brief?: ApprovalBrief; /** The signed-in person has not opened this decision (no seen row for its Ticket, need and decision time). */ unseen?: boolean }
/** Waiting longer than this is shown in the warn tone. */
export const OVERDUE_MS = 24 * 3600_000

export type InboxGroup = { checkpoint: Checkpoint; items: InboxItem[] }

/** The view of a stored Decision (or one built from the row when the sweep has not reached the Ticket yet) that cards render. */
export const cardOf = (t: Doc, product: { id: number; name: string; stagingUrl?: string | null }, urgentReason?: string | null): InboxItem | null => {
  if (!isNeed(t.needsYou)) return null
  const decision: Decision = t.decision?.need === t.needsYou ? t.decision : buildDecision(t.needsYou, { urgentReason, ticket: t as never, product, planTldr: t.planTldr, stagingTldr: t.stagingTldr, human: humanStage(t) })
  return { id: t.id, number: t.number, product: { id: product.id, name: product.name }, decision, detailsHtml: decision.details ? renderMarkdown(decision.details) : null, waiting: waited(decision.openSince), overdue: Date.now() - +new Date(decision.openSince) > OVERDUE_MS, fastLane: !!t.expedite }
}

/** The card of a distilled skill proposal (the Ticket it was learned from carries the card's id and number). */
const skillCard = (sp: Doc, t: Doc, product: { id: number; name: string }): InboxItem => {
  const name = String(sp.skillPath ?? '').replace(/^workspace\/skills\/|\/SKILL\.md$/g, '')
  const decision = buildDecision(SKILL_NEED, { ticket: t as never, product, skill: { name, score: sp.score ?? null, baseline: sp.baselineScore ?? null, pr: sp.pr ?? null }, now: sp.createdAt })
  return { id: t.id, number: t.number, product: { id: product.id, name: product.name }, decision, detailsHtml: null, waiting: waited(decision.openSince), overdue: Date.now() - +new Date(decision.openSince) > OVERDUE_MS }
}

/**
 * The Inbox of a Workspace: every open Ticket with `needsYou` set (the source of the top bar's count) plus, for an Admin, every pending skill proposal, as cards grouped by checkpoint in workflow order, oldest first.
 * Database only. A person sees the cards they may decide; `product` narrows to one Product. A Product owner sees only the cards that ask them (`needsBy`) on the Products of their assignment, a Bauherr or Admin every card (marked `asked` where it asks the Product owner).
 */
export const loadInbox = async (workspace: number, user: Doc, opts: { product?: number; checkpoint?: string } = {}): Promise<{ groups: InboxGroup[]; counts: Partial<Record<Checkpoint, number>>; products: { id: number; name: string }[]; working: number }> => {
  const payload = await payloadClient()
  const o = { depth: 0, overrideAccess: true, pagination: false } as const
  const owner = isProductOwner(user)
  const [rows, products, working] = await Promise.all([
    payload.find({ collection: 'tickets', where: { and: [{ workspace: { equals: workspace } }, { state: { equals: 'open' } }, { needsYou: { exists: true } }, ...(owner ? [asksOwner, productScope(user, workspace)] : []), ...(opts.product ? [{ product: { equals: opts.product } }] : [])] }, select: { workspace: true, expedite: true, needsBy: true, openOwnerRows: true, number: true, title: true, product: true, needsYou: true, decision: true, stage: true, reviewRounds: true, openCriticalDecisions: true, releaseRunUrl: true, releasedIn: true, planTldr: true, stagingTldr: true, approvalBrief: true }, ...o }),
    payload.find({ collection: 'products', where: productsVisibleTo(user, workspace), select: { name: true, stagingUrl: true, reviewChecks: true, pathSets: true }, sort: 'name', ...o }),
    payload.count({ collection: 'tickets', where: { and: [{ workspace: { equals: workspace } }, { state: { equals: 'open' } }, { needsYou: { exists: false } }, ...(owner ? [productScope(user, workspace)] : [])] }, overrideAccess: true }),
  ])
  const byId = new Map((products.docs as Doc[]).map((p) => [p.id as number, p]))
  const proposals = !canDecide(user, SKILL_NEED) ? [] : ((await payload.find({ collection: 'skill_proposals', where: { workspace: { equals: workspace }, status: { in: ['proposed', 'replayed'] }, pr: { exists: true } }, sort: 'createdAt', ...o, depth: 1 })).docs as Doc[])
  const reasons = await urgentReasons(payload, (rows.docs as Doc[]).filter((t) => t.needsYou === 'Expedite?') as never)
  const all = [
    ...(rows.docs as Doc[]).flatMap((t) => {
      const p = byId.get(t.product)
      const card = p && cardOf(t, p as never, reasons.get(`${t.product}:${t.number}`))
      return card ? [{ ...card, ...(!owner && t.needsBy === 'product-owner' && { asked: 'product-owner' as const }) }] : []
    }),
    ...proposals.flatMap((sp) => {
      const t = sp.ticket as Doc | null
      const p = byId.get(t?.product?.id ?? t?.product)
      return t && p && (!opts.product || p.id === opts.product) ? [skillCard(sp, t, p as never)] : []
    }),
  ].filter((card) => canDecide(user, card.decision.need))
  const counts: Partial<Record<Checkpoint, number>> = {}
  for (const i of all) counts[i.decision.checkpoint] = (counts[i.decision.checkpoint] ?? 0) + 1
  const items = opts.checkpoint ? all.filter((i) => i.decision.checkpoint === opts.checkpoint) : all
  const seen = items.length ? (await payload.find({ collection: 'inbox_seen', where: { user: { equals: user.id }, ticket: { in: items.map((i) => i.id) } }, select: { ticket: true, need: true, since: true }, ...o })).docs.map((r) => ({ ticket: r.ticket as number, need: r.need as string, since: r.since as string })) : []
  const unseen = unseenOf(seen, items)
  for (const i of items) i.unseen = unseen.has(i.id)
  const forProof = items.filter((i) => PROOF_NEEDS.includes(i.decision.need))
  if (forProof.length) {
    const rowsById = new Map((rows.docs as Doc[]).map((t) => [t.id as number, t]))
    const proof = await loadProof(payload, forProof.map((i) => rowsById.get(i.id)!), new Map([...byId].map(([k, p]) => [k, p as Doc])))
    for (const i of forProof) {
      const p = proof.get(i.id)
      if (p) i.proof = p
      const brief = rowsById.get(i.id)?.approvalBrief
      if (brief && BRIEF_NEEDS.includes(i.decision.need)) i.brief = brief
    }
  }
  const groups = CHECKPOINTS.map((checkpoint) => ({ checkpoint, items: items.filter((i) => i.decision.checkpoint === checkpoint).sort((a, b) => Number(b.decision.need === 'Expedite?') - Number(a.decision.need === 'Expedite?') || a.decision.openSince.localeCompare(b.decision.openSince) || a.number - b.number) })).filter((g) => g.items.length)
  return { groups, counts, products: (products.docs as Doc[]).map((p) => ({ id: p.id, name: p.name })), working: working.totalDocs }
}
