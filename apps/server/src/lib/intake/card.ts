import { questionsAsked, readiness, refersToScreen, splitReadiness, type Draft, type Session } from './engine'
import type { Kind } from './kinds'

type Doc = Record<string, any>

export const missingWords = (kind: Kind, missing: string[]): string[] =>
  missing.map((m) => {
    if (m === 'problem') return kind === 'bug' ? 'what happens' : kind === 'question' ? 'your question' : 'what is wanted, and why'
    if (m === 'context') return 'where it happens'
    if (m === 'acceptance_criteria') return kind === 'bug' ? 'what should happen instead' : 'at least one "It is done when"'
    if (m === 'urgent_reason') return 'what is broken, for whom, since when'
    if (m === 'screenshot') return 'a screenshot'
    return m
  })

export type CardImage = { id: number; name: string; url: string }
export type CardData = {
  session: number
  editable: boolean
  sent: boolean
  product: { id: number; name: string } | null
  productChoices: { id: number; name: string }[]
  title: string
  kind: Kind
  urgency: 'normal' | 'urgent'
  urgentReason: string
  problem: string
  context: string
  criteria: string[]
  images: CardImage[]
  missing: string[]
  needs: string[]
  changed: string[]
  parts: number
  items: string[]
  canSend: boolean
  fastLane: boolean
  split: boolean
  followUp: number | null
  ticket: number | null
  maxImages: number
}

export const cardOf = (s: Doc, o: { editable: boolean; images: CardImage[]; fastLane: boolean; maxImages: number; products?: { id: number; name: string }[]; followUp?: number | null }): CardData => {
  const d: Draft | null = s.draft ?? null
  const kind: Kind = d?.type ?? s.kind ?? 'feature'
  const session: Session = { messages: s.messages ?? [], draft: d, screenshots: s.screenshots }
  const split = !!s.split?.length
  const ready = [(s.screenshots ?? 0) > 0, refersToScreen(session, s.turn?.needsScreenshot === true), questionsAsked(session)] as const
  const r = split ? splitReadiness(s.split, ...ready) : readiness(d, ...ready)
  const missing = split ? r.missing.map((m) => `request ${m.split(': ')[0]}: ${missingWords(kind, [m.split(': ')[1]!])[0]}`) : missingWords(kind, r.missing)
  const product = s.product && typeof s.product === 'object' ? { id: s.product.id as number, name: s.product.name as string } : null
  return {
    session: s.id,
    editable: o.editable && s.status === 'open',
    sent: s.status === 'submitted',
    product,
    productChoices: o.editable && s.status === 'open' && !(s.messages ?? []).length ? (o.products ?? []) : [],
    title: d?.title ?? s.title ?? '',
    kind,
    urgency: d?.urgency === 'urgent' ? 'urgent' : 'normal',
    urgentReason: d?.urgent_reason ?? '',
    problem: d?.problem ?? '',
    context: d?.context ?? '',
    criteria: (d?.acceptance_criteria ?? []).filter((c) => c.trim()),
    images: o.images,
    missing,
    needs: split ? [] : r.missing,
    changed: Array.isArray(s.turn?.changed) ? s.turn.changed : [],
    parts: s.split?.length ?? 0,
    items: ((s.split ?? []) as Draft[]).map((i) => i.problem),
    canSend: r.ready || r.exhausted,
    fastLane: o.fastLane,
    split,
    followUp: o.followUp ?? null,
    ticket: s.ticketNumber ?? null,
    maxImages: o.maxImages,
  }
}
