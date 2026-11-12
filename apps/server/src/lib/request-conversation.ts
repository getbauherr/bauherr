import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { abandonIntake, exclusive, submitIntake } from './actions'
import { tierModels } from './chat/engine'
import type { Who } from './chat/threads'
import { laneOn } from './expedite'
import { SESSIONS_PER_USER_HOUR } from './intake/api'
import { cardOf, type CardData } from './intake/card'
import { CARD_FIELDS, KINDS, cardColumns, emptyDraft, type CardField, type Draft, type Kind, type Message, type TurnHooks } from './intake/engine'
import { mediaLimits, mediaUrl, type ImageMime } from './intake/media'
import { advance } from './intake/turn'
import { canSeeProduct, productsVisibleTo } from './people'
import { costOf, type Participant, type View } from './refine/engine'
import { TIERS, type Msg, type Tier } from './refine/model'

type Doc = Record<string, any>
const o = { depth: 0, overrideAccess: true } as const
const idOf = (v: unknown): number => Number(v && typeof v === 'object' ? (v as { id: number }).id : v)

export type Product = { id: number; name: string }

/** The Products of the Workspace the person may start a request for (a Product owner: their assignment). */
const productsOf = async (w: Who): Promise<Product[]> =>
  (await w.payload.find({ collection: 'products', where: productsVisibleTo(w.user, w.workspace), sort: 'name', pagination: false, select: { name: true }, ...o })).docs.map((p: Doc) => ({ id: p.id, name: p.name }))

/** A request session of this person in this Workspace (open or sent) for a Product they may see, else null: never a hint that another one exists. */
const ownSessionOf = async (w: Who, id: unknown): Promise<Doc | null> => {
  if (!/^\d+$/.test(String(id))) return null
  const s = (await w.payload.findByID({ collection: 'intake_sessions', id: Number(id), depth: 1, overrideAccess: true }).catch(() => null)) as Doc | null
  return s && s.persona === 'product-user' && ['open', 'submitted'].includes(s.status) && idOf(s.user) === Number(w.user.id) && idOf(s.workspace) === w.workspace && canSeeProduct(w.user, { id: idOf(s.product), workspace: w.workspace }) ? s : null
}

/** The person's empty draft for a Product (the first of their Products, or `want`), reused when they left one; else a new one. Null when they have no Product here. Throws when too many were started in the last hour. */
export const startDraft = async (w: Who, want?: number): Promise<number | null> => {
  const products = await productsOf(w)
  if (!products.length) return null
  const product = products.find((p) => p.id === want) ?? products[0]!
  const mine = (await w.payload.find({ collection: 'intake_sessions', where: { and: [{ user: { equals: w.user.id } }, { workspace: { equals: w.workspace } }, { persona: { equals: 'product-user' } }, { status: { equals: 'open' } }] }, sort: '-createdAt', limit: 20, select: { messages: true, draft: true, product: true }, ...o })).docs as Doc[]
  const empty = mine.find((s) => !s.messages?.length && !s.draft && products.some((p) => p.id === idOf(s.product)))
  if (empty) {
    if (want && idOf(empty.product) !== product.id) await w.payload.update({ collection: 'intake_sessions', id: empty.id, data: { product: product.id }, ...o })
    return Number(empty.id)
  }
  const recent = await w.payload.count({ collection: 'intake_sessions', where: { and: [{ user: { equals: w.user.id } }, { createdAt: { greater_than: new Date(Date.now() - 3_600_000).toISOString() } }] }, overrideAccess: true })
  if (recent.totalDocs >= SESSIONS_PER_USER_HOUR) throw new Error('Too many requests started in the last hour, try again later.')
  return Number((await w.payload.create({ collection: 'intake_sessions', data: { product: product.id, workspace: w.workspace, persona: 'product-user', status: 'open', messages: [], user: w.user.id }, ...o })).id)
}

/** Deletes the drafts nobody wrote to (no message, no card, older than `olderThanMs`) and the old docked request threads without a message. Returns the drafts deleted. */
export const pruneEmptyRequests = async (payload: Payload, { olderThanMs = 3_600_000 }: { olderThanMs?: number } = {}): Promise<number> => {
  const run = (q: ReturnType<typeof sql>) => payload.db.drizzle.execute(q)
  const before = new Date(Date.now() - olderThanMs).toISOString()
  await run(sql`DELETE FROM "chat_threads" t WHERE t."request" AND t."created_at" < ${before}::timestamptz AND NOT EXISTS (SELECT 1 FROM "chat_messages" m WHERE m."thread_id" = t."id")`)
  const gone = await run(sql`DELETE FROM "intake_sessions" s WHERE s."status" = 'open' AND s."persona" = 'product-user' AND s."draft" IS NULL AND COALESCE(jsonb_array_length(s."messages"), 0) = 0 AND s."created_at" < ${before}::timestamptz AND NOT EXISTS (SELECT 1 FROM "chat_threads" t WHERE t."intake_session_id" = s."id") RETURNING s."id"`)
  return gone.rows.length
}

/** Discards one of the person's open drafts: the session is abandoned (it leaves the lists and the count). `NotInWorkspace` for anything that is not their open draft. */
export const discardRequest = (w: Who, session: number): Promise<void> => abandonIntake(w.payload, w.user, session)

/** The card of any request of the Workspace for a viewer (`editable`: the author of an open draft). */
export const cardData = async (w: Who, s: Doc, editable: boolean): Promise<CardData> => {
  const media = (await w.payload.find({ collection: 'media', where: { session: { equals: s.id } }, sort: 'id', pagination: false, select: { name: true, mime: true, mimeType: true }, ...o })).docs as Doc[]
  const followUp = s.followUpOf ? ((await w.payload.findByID({ collection: 'intake_sessions', id: idOf(s.followUpOf), depth: 0, select: { ticketNumber: true }, overrideAccess: true }).catch(() => null)) as Doc | null)?.ticketNumber ?? null : null
  return cardOf(s, { editable, images: media.map((m) => ({ id: m.id, name: m.name, url: mediaUrl(m.id, (m.mime ?? m.mimeType) as ImageMime) })), fastLane: await laneOn(w.payload, w.workspace), maxImages: mediaLimits().maxPerSession, products: editable ? await productsOf(w) : [], followUp })
}

export type CardPatch = Partial<{ title: string; type: Kind; urgency: 'normal' | 'urgent'; urgent_reason: string; problem: string; context: string; acceptance_criteria: string[]; product: number }>
const CAPS = { title: 80, problem: 1000, context: 2000, urgent_reason: 500 } as const

/** A direct edit of the card by the person: stored on the draft and the session, and remembered as theirs, so the next turn keeps it and the interview sees it. Throws a plain-words error for what the card does not allow. */
const editCard = async (w: Who, s: Doc, patch: CardPatch): Promise<void> => {
  if (s.status !== 'open') throw new Error('This request cannot be edited.')
  await exclusive(`intake:${s.id}`, async () => {
    const have = (await w.payload.findByID({ collection: 'intake_sessions', id: s.id, ...o })) as Doc
    const draft: Draft = { ...emptyDraft(), ...(have.draft ?? {}) }
    const edited = new Set<CardField>((have.edited ?? []) as CardField[])
    const set = <K extends CardField>(k: K, v: Draft[K] | undefined) => {
      if (v === undefined) delete (draft as Record<string, unknown>)[k]
      else (draft as Record<string, unknown>)[k] = v
      edited.add(k)
    }
    for (const k of ['title', 'problem', 'context', 'urgent_reason'] as const) if (patch[k] !== undefined) set(k, (k === 'title' ? String(patch[k]).replace(/\s+/g, ' ') : String(patch[k])).trim().slice(0, CAPS[k]))
    if (patch.acceptance_criteria) set('acceptance_criteria', patch.acceptance_criteria.map((c) => String(c).trim().slice(0, 500)).filter(Boolean).slice(0, 10))
    if (patch.type) {
      if (!KINDS.includes(patch.type)) throw new Error('Choose a type from the list.')
      set('type', patch.type)
    }
    if (draft.type !== 'bug' && draft.urgency) {
      set('urgency', undefined)
      set('urgent_reason', undefined)
    }
    if (patch.urgency === 'urgent') {
      if (draft.type !== 'bug') throw new Error('Only a bug can be urgent.')
      if (have.split?.length) throw new Error('An urgent request is sent alone.')
      if (!(await laneOn(w.payload, w.workspace))) throw new Error('The fast lane is off for this Workspace, so nothing can be marked urgent.')
      set('urgency', 'urgent')
    }
    if (patch.urgency === 'normal') {
      set('urgency', undefined)
      set('urgent_reason', undefined)
    }
    const data: Doc = { draft, ...cardColumns(draft), edited: CARD_FIELDS.filter((f) => edited.has(f)) }
    if (patch.product !== undefined) {
      if (have.messages?.length) throw new Error('The product is fixed once the conversation has started.')
      const p = (await productsOf(w)).find((x) => x.id === Number(patch.product))
      if (!p) throw new Error('This product could not be chosen.')
      data.product = p.id
    }
    await w.payload.update({ collection: 'intake_sessions', id: s.id, data, ...o })
  })
}

/** Removes one of the request's screenshots (an open draft only). */
const removeImage = async (w: Who, s: Doc, mediaId: number): Promise<void> => {
  if (s.status !== 'open') throw new Error('This request cannot be edited.')
  await exclusive(`intake:${s.id}`, async () => {
    const m = (await w.payload.find({ collection: 'media', where: { and: [{ id: { equals: mediaId } }, { session: { equals: s.id } }] }, limit: 1, ...o })).docs[0]
    if (!m) return
    await w.payload.delete({ collection: 'media', id: m.id, ...o })
    const have = (await w.payload.findByID({ collection: 'intake_sessions', id: s.id, ...o })) as Doc
    await w.payload.update({ collection: 'intake_sessions', id: s.id, data: { screenshots: Math.max(0, (have.screenshots ?? 0) - 1) }, ...o })
  })
}

/** What the request conversation shows; every action answers it whole, so the client never merges. */
export type RequestView = {
  session: number
  sent: boolean
  card: CardData
  messages: Msg[]
  /** The answers the last question suggests (empty: none, or the conversation is over). */
  options: { label: string; recommended: boolean }[]
  participant: Participant
  /** The Workspace's models per tier; the request conversation always runs on `tier`. */
  models: View['models']
  tier: Tier
  cost: View['cost']
  /** The foot's status line and the line under "File request". */
  status: string
  next: string
  /** After filing: where the request went (`ticket` once the factory has synced it). */
  handoff: { numbers: number[]; ticket: { id: number; number: number } | null } | null
}

const PARTICIPANT: Participant = { role: 'Factory assistant', avatar: 'factory-assistant', about: 'Drafts the request with you: it asks a few questions, keeps the request card up to date while you talk, and hands the card to the team when you file it.', session: null }
const speaker = (m: Message, at: string): Msg['speaker'] => (m.role === 'user' ? { kind: 'person', at } : { kind: 'assistant', role: PARTICIPANT.role, avatar: PARTICIPANT.avatar, model: m.usage?.model ?? null, at })

/** The stored interview as conversation messages (ids by position; `at` of an older message falls back to the session's last change). */
export const messagesOf = (s: Doc): Msg[] =>
  ((s.messages ?? []) as Message[]).map((m, i) => ({
    id: `${s.id}-${i}`,
    role: m.role,
    text: m.content,
    speaker: speaker(m, m.at ?? s.updatedAt),
    ...(m.images?.length && { images: m.images.map((id) => ({ id: Number(id), url: `/intake/api/media/${id}` })) }),
    ...(m.usage && { usage: m.usage }),
  }))

/** The words of what is still open on the card and of what happens after filing. */
export const footOf = (card: CardData): { status: string; next: string } => {
  const status = card.sent
    ? card.ticket ? `Filed as #${card.ticket}.` : 'Filed.'
    : card.kind === 'question' ? 'A question is answered here and files nothing.'
    : !card.missing.length ? 'Ready to file.'
    : card.canSend ? `Can be filed. Still open: ${card.missing.join(', ')}. The team can ask later.`
    : `Still needed: ${card.missing.join(', ')}.`
  const next = card.sent ? 'The team has it.' : card.urgency === 'urgent' ? 'Then: the Bauherr decides on the fast lane, and the team looks at it.' : card.parts > 1 ? `Then: ${card.parts} Tickets are created and the team looks at each.` : 'Then: the team looks at it and may ask you more. You can follow it under Requests.'
  return { status, next }
}

const viewOf = async (w: Who, s: Doc): Promise<RequestView> => {
  const editable = s.status === 'open'
  const card = await cardData(w, s, editable)
  const messages = messagesOf(s)
  const models = tierModels((await w.payload.findByID({ collection: 'workspaces', id: w.workspace, ...o })) as Doc)
  const asking = editable && messages.at(-1)?.role === 'assistant'
  const numbers: number[] = s.ticketNumbers?.length ? s.ticketNumbers : s.ticketNumber != null ? [s.ticketNumber] : []
  const ticket = numbers.length ? ((await w.payload.find({ collection: 'tickets', where: { and: [{ workspace: { equals: w.workspace } }, { product: { equals: idOf(s.product) } }, { number: { equals: numbers[0] } }] }, limit: 1, select: { number: true }, ...o })).docs[0] as Doc | undefined) : undefined
  return {
    session: s.id,
    sent: s.status === 'submitted',
    card,
    messages,
    options: asking ? ((s.turn?.options ?? []) as { label: string; recommended?: boolean }[]).map((x) => ({ label: x.label, recommended: !!x.recommended })) : [],
    participant: PARTICIPANT,
    models: TIERS.map((tier) => ({ tier, model: models[tier] })),
    tier: 'standard',
    cost: costOf(messages),
    ...footOf(card),
    handoff: s.status === 'submitted' ? { numbers, ticket: ticket ? { id: ticket.id, number: ticket.number } : null } : null,
  }
}

/** The conversation of one of the person's requests (an open draft or a sent request); null when it is not theirs. */
export const loadRequestView = async (w: Who, id: unknown): Promise<RequestView | null> => {
  const s = await ownSessionOf(w, id)
  return s ? viewOf(w, s) : null
}

/** Whether the request is the person's own (an open draft or a filed request) for a Product they may see. */
export const ownsRequest = async (w: Who, id: unknown): Promise<boolean> => !!(await ownSessionOf(w, id))

const own = async (w: Who, id: unknown): Promise<Doc> => {
  const s = await ownSessionOf(w, id)
  if (!s) throw new Error('This request was not found.')
  return s
}

/** Adds the person's uploaded, unused images of the Workspace to the draft (at most `maxPerSession` in all); the ids that now belong to it. */
const adopt = (w: Pick<Who, 'payload' | 'workspace'>, s: Doc, ids: number[]): Promise<number[]> =>
  exclusive(`intake:${s.id}`, async () => {
    if (!ids.length) return []
    const { maxPerSession } = mediaLimits()
    const fresh = (await w.payload.find({ collection: 'media', where: { and: [{ id: { in: ids } }, { workspace: { equals: w.workspace } }, { or: [{ session: { equals: s.id } }, { and: [{ session: { exists: false } }, { product: { exists: false } }, { attached: { equals: false } }] }] }] }, pagination: false, ...o })).docs as Doc[]
    if (fresh.length !== new Set(ids).size) throw new Error('An image is missing or already used in another request.')
    const fix = fresh.filter((m) => !m.session)
    const have = (await w.payload.findByID({ collection: 'intake_sessions', id: s.id, ...o })) as Doc
    if ((have.screenshots ?? 0) + fix.length > maxPerSession) throw new Error(`At most ${maxPerSession} screenshots per request.`)
    for (const m of fix) await w.payload.update({ collection: 'media', id: m.id, data: { session: s.id }, ...o })
    if (fix.length) await w.payload.update({ collection: 'intake_sessions', id: s.id, data: { screenshots: (have.screenshots ?? 0) + fix.length }, ...o })
    return fresh.map((m) => m.id as number)
  })

/** One turn of the interview: the person's text (and screenshots, ids from the media route) go to the intake engine, which answers the next question and updates the card; nothing is stored when the call fails or is aborted. The reply streams through `hooks.onPartial`. */
export const requestTurn = async (w: Who, a: TurnHooks & { session: number; text: string; images?: number[] }): Promise<RequestView> => {
  const s = await own(w, a.session)
  if (s.status !== 'open') throw new Error('This request is already filed.')
  const shots = await adopt(w, s, a.images ?? [])
  await exclusive(`intake:${s.id}`, async () => advance(w.payload, (await own(w, a.session)), a.text, shots, { signal: a.signal, onPartial: a.onPartial }))
  return viewOf(w, await own(w, a.session))
}

/** A direct edit of the card, or the removal of one screenshot, by the author of an open draft. */
export const requestEdit = async (w: Who, session: number, change: { patch: CardPatch } | { removeImage: number }): Promise<RequestView> => {
  const s = await own(w, session)
  if ('patch' in change) await editCard(w, s, change.patch)
  else await removeImage(w, s, change.removeImage)
  return viewOf(w, await own(w, session))
}

/** "File request": the Ticket(s) are created from the card exactly as it stands (the engine decides whether it is complete); the conversation is read-only history afterwards. */
export const requestFile = async (w: Who, session: number): Promise<RequestView> => {
  const s = await own(w, session)
  if (s.status === 'open') await submitIntake(w.payload, s.id, s.split?.length ? s.split.length : undefined)
  return viewOf(w, await own(w, session))
}
