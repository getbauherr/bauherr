import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { abandonIntake, exclusive } from '../actions'
import { SESSIONS_PER_USER_HOUR } from '../intake/api'
import { cardOf, type CardData } from '../intake/card'
import { KIND_LABEL, SEND_TEXT } from '../intake/kinds'
import { CARD_FIELDS, KINDS, cardColumns, emptyDraft, type CardField, type Draft, type Kind } from '../intake/engine'
import { laneOn } from '../expedite'
import { mediaLimits, mediaUrl, type ImageMime } from '../intake/media'
import { advanceIntake } from '../intake/turn'
import type { ChatEvent, ChatInput } from './engine'
import { deleteThread, dropPending, finishAnswer, startAnswer, storePending, upsertMessage, ownThread, type Answer, type Who } from './threads'
import { runChatTool, type Card } from './tools'
import type { Ctx } from '../mcp-tools'
import { randomUUID } from 'node:crypto'

type Doc = Record<string, any>
const o = { depth: 0, overrideAccess: true } as const
const idOf = (v: unknown): number => Number(v && typeof v === 'object' ? (v as { id: number }).id : v)

/** `products`: the Products to choose from while the Workspace has several and nothing was said yet (empty otherwise). */
export type RequestInfo = { session: number | null; sent: boolean; product: string | null; productId: number | null; products: { id: number; name: string }[] }

const productsOf = async (w: Who): Promise<{ id: number; name: string }[]> =>
  (await w.payload.find({ collection: 'products', where: { workspace: { equals: w.workspace } }, sort: 'name', pagination: false, select: { name: true }, ...o })).docs.map((p: Doc) => ({ id: p.id, name: p.name }))

/** A request session of this person in this Workspace (open or sent), else null. */
const ownSessionOf = async (w: Who, id: unknown): Promise<Doc | null> => {
  if (!/^\d+$/.test(String(id))) return null
  const s = (await w.payload.findByID({ collection: 'intake_sessions', id: Number(id), depth: 1, overrideAccess: true }).catch(() => null)) as Doc | null
  return s && s.persona === 'product-user' && ['open', 'submitted'].includes(s.status) && idOf(s.user) === Number(w.user.id) && idOf(s.workspace) === w.workspace ? s : null
}

/** What the dock needs of a request thread: its session, Product and (while no Product is chosen) the Products to choose from; null for any other thread. */
export const requestInfo = async (w: Who, t: Doc): Promise<RequestInfo | null> => {
  if (!t.request) return null
  const s = t.intakeSession ? await ownSessionOf(w, idOf(t.intakeSession)) : null
  const products = !s || (s.status === 'open' && !s.messages?.length) ? await productsOf(w) : []
  return { session: s ? Number(s.id) : null, sent: s?.status === 'submitted', product: s ? ((s.product as Doc).name ?? null) : null, productId: s ? Number((s.product as Doc).id) : null, products: products.length > 1 ? products : [] }
}

/** Starts the interview session of a request thread for a Product of the Workspace and links the thread to it; until the first message the Product can still be changed, after it the session keeps its Product. Null when the thread is not this person's request thread or the Product is not in the Workspace. */
export const chooseProduct = async (w: Who, threadId: number | string, product: number): Promise<{ session: number; product: string } | null> => {
  const t = await ownThread(w, threadId)
  if (!t?.request) return null
  const have = t.intakeSession ? await ownSessionOf(w, idOf(t.intakeSession)) : null
  const p = (await productsOf(w)).find((x) => x.id === Number(product))
  if (have && !(have.status === 'open' && !have.messages?.length && p && p.id !== Number((have.product as Doc).id))) return { session: Number(have.id), product: (have.product as Doc).name }
  if (!p) return null
  if (have) {
    await w.payload.update({ collection: 'intake_sessions', id: have.id, data: { product: p.id }, ...o })
    return { session: Number(have.id), product: p.name }
  }
  const recent = await w.payload.count({ collection: 'intake_sessions', where: { and: [{ user: { equals: w.user.id } }, { createdAt: { greater_than: new Date(Date.now() - 3_600_000).toISOString() } }] }, overrideAccess: true })
  if (recent.totalDocs >= SESSIONS_PER_USER_HOUR) throw new Error('Too many requests started in the last hour, try again later.')
  const s = await w.payload.create({ collection: 'intake_sessions', data: { product: p.id, workspace: w.workspace, persona: 'product-user', status: 'open', messages: [], user: w.user.id }, ...o })
  await w.payload.update({ collection: 'chat_threads', id: t.id, data: { intakeSession: s.id }, ...o })
  return { session: Number(s.id), product: p.name }
}

/** Deletes request threads nobody wrote to (no message, not even an unanswered turn) and, with them, the interview sessions they started that are still empty: `owner` limits it to one person, `except` keeps one thread, `olderThanMs` leaves recent ones alone. Returns the threads deleted. */
export const pruneEmptyRequests = async (payload: Payload, { owner, except, olderThanMs = 3_600_000 }: { owner?: number | string; except?: number | string; olderThanMs?: number } = {}): Promise<number> => {
  const run = (q: ReturnType<typeof sql>) => payload.db.drizzle.execute(q)
  const gone = (await run(sql`DELETE FROM "chat_threads" t WHERE t."request" AND t."created_at" < ${new Date(Date.now() - olderThanMs).toISOString()}::timestamptz AND (${owner ?? null}::int IS NULL OR t."owner_id" = ${owner ?? null}::int) AND (${except ?? null}::int IS NULL OR t."id" <> ${except ?? null}::int) AND NOT EXISTS (SELECT 1 FROM "chat_messages" m WHERE m."thread_id" = t."id") RETURNING t."intake_session_id" AS session`)).rows as { session: number | null }[]
  for (const { session } of gone) {
    if (session) await run(sql`DELETE FROM "intake_sessions" WHERE "id" = ${session} AND "status" = 'open' AND "persona" = 'product-user' AND "draft" IS NULL AND COALESCE(jsonb_array_length("messages"), 0) = 0`)
  }
  return gone.length
}

/** Discards one of the person's open drafts: the session is abandoned (it leaves the lists and the count) and its thread, with the conversation, is deleted. `NotInWorkspace` for anything that is not their open draft. */
export const discardRequest = async (w: Who, session: number): Promise<void> => {
  await abandonIntake(w.payload, w.user, session)
  const t = (await w.payload.find({ collection: 'chat_threads', where: { and: [{ owner: { equals: w.user.id } }, { workspace: { equals: w.workspace } }, { intakeSession: { equals: session } }] }, limit: 1, ...o })).docs[0] as Doc | undefined
  if (t) await deleteThread(w, String(t.id))
}

/** The person's thread for a new request: an empty one they left is reused (a conversation is never resumed here), other empty ones of theirs are deleted; the Product is chosen at once when the Workspace has only one. Null when the Workspace has no Product. */
export const newRequestThread = async (w: Who): Promise<Doc | null> => {
  const products = await productsOf(w)
  if (!products.length) return null
  const mine = (await w.payload.find({ collection: 'chat_threads', where: { and: [{ owner: { equals: w.user.id } }, { workspace: { equals: w.workspace } }, { request: { equals: true } }, { archivedAt: { exists: false } }] }, sort: '-lastMessageAt', limit: 10, ...o })).docs as Doc[]
  let t: Doc | undefined
  for (const c of mine) {
    const s = c.intakeSession ? await ownSessionOf(w, idOf(c.intakeSession)) : null
    if (!c.intakeSession || (s?.status === 'open' && !s.messages?.length)) {
      t = c
      break
    }
  }
  t ??= (await w.payload.create({ collection: 'chat_threads', data: { owner: w.user.id, workspace: w.workspace, request: true, context: { path: '/requests/new', label: 'New request' }, lastMessageAt: new Date().toISOString() }, ...o })) as Doc
  await pruneEmptyRequests(w.payload, { owner: w.user.id, except: t.id, olderThanMs: 0 })
  if (!t.intakeSession && products.length === 1) await chooseProduct(w, t.id, products[0]!.id)
  return (await w.payload.findByID({ collection: 'chat_threads', id: t.id, ...o })) as Doc
}

/** The thread of one of the person's requests, created on first use (an older request gets its interview as messages) and brought back from the archive. Null when the request is not theirs. */
export const requestThread = async (w: Who, session: unknown): Promise<Doc | null> => {
  const s = await ownSessionOf(w, session)
  if (!s) return null
  const find = async () => (await w.payload.find({ collection: 'chat_threads', where: { and: [{ owner: { equals: w.user.id } }, { workspace: { equals: w.workspace } }, { intakeSession: { equals: s.id } }] }, limit: 1, ...o })).docs[0] as Doc | undefined
  let t = await find()
  if (!t) {
    const title = String(s.title || s.draft?.problem || '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Request'
    t = (await w.payload.create({ collection: 'chat_threads', data: { owner: w.user.id, workspace: w.workspace, request: true, intakeSession: s.id, title, context: { path: `/requests/${s.id}`, label: `Request: ${title}` }, lastMessageAt: new Date().toISOString() }, ...o }).catch(find)) as Doc | undefined
    if (t) {
      let parent: string | null = null
      for (const m of (s.messages ?? []) as { role: string; content: string }[]) {
        const id = randomUUID()
        const base = { id, createdAt: new Date().toISOString(), content: [{ type: 'text', text: m.content }] }
        await upsertMessage(w, String(t.id), { parentId: parent, message: m.role === 'user' ? { ...base, role: 'user', attachments: [], metadata: { custom: {} } } : { ...base, role: 'assistant', status: { type: 'complete', reason: 'unknown' }, metadata: { unstable_state: null, unstable_annotations: [], unstable_data: [], steps: [], custom: {} } } })
        parent = id
      }
    }
  }
  if (!t) return null
  return t.archivedAt ? ((await w.payload.update({ collection: 'chat_threads', id: t.id, data: { archivedAt: null }, ...o })) as Doc) : t
}

/** The card of one of the person's requests; null when it is not theirs. */
export const requestCard = async (w: Who, id: unknown): Promise<CardData | null> => {
  const s = await ownSessionOf(w, id)
  return s ? cardData(w, s, true) : null
}

/** The card of any request of the Workspace for a viewer (`editable`: the author of an open draft). */
export const cardData = async (w: Who, s: Doc, editable: boolean): Promise<CardData> => {
  const media = (await w.payload.find({ collection: 'media', where: { session: { equals: s.id } }, sort: 'id', pagination: false, select: { name: true, mime: true, mimeType: true }, ...o })).docs as Doc[]
  const followUp = s.followUpOf ? ((await w.payload.findByID({ collection: 'intake_sessions', id: idOf(s.followUpOf), depth: 0, select: { ticketNumber: true }, overrideAccess: true }).catch(() => null)) as Doc | null)?.ticketNumber ?? null : null
  return cardOf(s, { editable, images: media.map((m) => ({ id: m.id, name: m.name, url: mediaUrl(m.id, (m.mime ?? m.mimeType) as ImageMime) })), fastLane: await laneOn(w.payload, w.workspace), maxImages: mediaLimits().maxPerSession, products: editable ? await productsOf(w) : [], followUp })
}

export type CardPatch = Partial<{ title: string; type: Kind; urgency: 'normal' | 'urgent'; urgent_reason: string; problem: string; context: string; acceptance_criteria: string[]; product: number }>
const CAPS = { title: 80, problem: 1000, context: 2000, urgent_reason: 500 } as const

/** A direct edit of the card by the person: stored on the draft and the session, and remembered as theirs, so the next turn keeps it and the interview sees it. Throws a plain-words error for what the card does not allow. */
export const editCard = async (w: Who, id: unknown, patch: CardPatch): Promise<CardData> => {
  const s = await ownSessionOf(w, id)
  if (!s || s.status !== 'open') throw new Error('This request cannot be edited.')
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
  return (await requestCard(w, id))!
}

/** Adds an uploaded, unused image of the Workspace to the request's screenshots. */
export const attachImage = async (w: Who, id: unknown, mediaId: number): Promise<CardData> => {
  const s = await ownSessionOf(w, id)
  if (!s || s.status !== 'open') throw new Error('This request cannot be edited.')
  await exclusive(`intake:${s.id}`, async () => {
    const m = (await w.payload.find({ collection: 'media', where: { and: [{ id: { equals: mediaId } }, { workspace: { equals: w.workspace } }, { session: { exists: false } }, { product: { exists: false } }, { attached: { equals: false } }] }, limit: 1, ...o })).docs[0]
    if (!m) throw new Error('The image is missing or already used.')
    const have = (await w.payload.findByID({ collection: 'intake_sessions', id: s.id, ...o })) as Doc
    if ((have.screenshots ?? 0) + 1 > mediaLimits().maxPerSession) throw new Error(`At most ${mediaLimits().maxPerSession} screenshots per request.`)
    await w.payload.update({ collection: 'media', id: m.id, data: { session: s.id }, ...o })
    await w.payload.update({ collection: 'intake_sessions', id: s.id, data: { screenshots: (have.screenshots ?? 0) + 1 }, ...o })
  })
  return (await requestCard(w, id))!
}

/** Removes one of the request's screenshots (an open draft only). */
export const removeImage = async (w: Who, id: unknown, mediaId: number): Promise<CardData> => {
  const s = await ownSessionOf(w, id)
  if (!s || s.status !== 'open') throw new Error('This request cannot be edited.')
  await exclusive(`intake:${s.id}`, async () => {
    const m = (await w.payload.find({ collection: 'media', where: { and: [{ id: { equals: mediaId } }, { session: { equals: s.id } }] }, limit: 1, ...o })).docs[0]
    if (!m) return
    await w.payload.delete({ collection: 'media', id: m.id, ...o })
    const have = (await w.payload.findByID({ collection: 'intake_sessions', id: s.id, ...o })) as Doc
    await w.payload.update({ collection: 'intake_sessions', id: s.id, data: { screenshots: Math.max(0, (have.screenshots ?? 0) - 1) }, ...o })
  })
  return (await requestCard(w, id))!
}

const lineOf = (v: string, n = 300) => (v.length > n ? `${v.slice(0, n)}…` : v)

/** The confirmation card of a finished draft: Product, request(s), context, criteria and what the Ticket does next. */
const confirmCard = (product: string, out: { draft: Draft; split?: Draft[]; ready: boolean; missing: string[] }): Card => {
  const many = out.split && out.split.length > 1 ? out.split : undefined
  const criteria = (many ?? [out.draft]).flatMap((d) => d.acceptance_criteria)
  return {
    title: many ? `Send these ${many.length} requests` : 'Send this request',
    details: [
      { label: 'Product', value: product },
      ...(many ? [] : [{ label: 'Type', value: KIND_LABEL[out.draft.type] }]),
      ...(!many && out.draft.urgency === 'urgent' ? [{ label: 'Urgent', value: lineOf(out.draft.urgent_reason ?? '', 200) }] : []),
      { label: many ? 'Requests' : 'Request', value: many ? many.map((d, i) => `${i + 1}. ${lineOf(d.problem, 160)}`).join('\n') : lineOf(out.draft.problem, 400) },
      ...(out.draft.context ? [{ label: 'Context', value: lineOf(out.draft.context) }] : []),
      ...(criteria.length ? [{ label: 'It is done when', value: criteria.slice(0, 6).map((c) => `- ${lineOf(c, 160)}`).join('\n') }] : []),
      ...(out.ready ? [] : [{ label: 'Still open', value: out.missing.join(', ') }]),
      { label: 'What happens next', value: many ? `${many.length} Tickets are created and go to Triage` : out.draft.urgency === 'urgent' ? 'A Ticket is created and asks the Bauherr for the fast lane' : 'A Ticket is created and goes to Triage' },
    ],
    approve: many ? `Create ${many.length} tickets` : 'Create request',
    decline: 'Keep editing',
    noReason: true,
  }
}

const usage = (t0: number) => ({ model: 'request', tokensIn: 0, tokensOut: 0, costUsd: null, ms: Date.now() - t0 })

/** One turn of a request thread: the person's text (and pasted screenshots) go to the intake interview; the answer is its next question with its option buttons, and a finished draft ends in the confirmation card. Nothing creates a Ticket until the person approves that card. */
export async function* runRequest(a: { payload: Payload; user: Doc; workspace: number; thread: Doc; messages: ChatInput[]; signal?: AbortSignal }): AsyncGenerator<ChatEvent> {
  const who: Who = { payload: a.payload, user: a.user, workspace: a.workspace }
  const t0 = Date.now()
  await dropPending(who, a.thread.id)
  const answerId = await startAnswer(who, a.thread.id)
  const tally: Answer['toolCalls'] = []
  let answered = false
  const finish = async () => {
    answered = true
    await finishAnswer(who, a.thread.id, answerId, { ...usage(t0), toolCalls: tally })
  }
  try {
    const s = a.thread.intakeSession ? await ownSessionOf(who, idOf(a.thread.intakeSession)) : null
    const say = async function* (text: string): AsyncGenerator<ChatEvent> {
      yield { type: 'delta', text }
      await finish()
      yield { type: 'done', answerId, usage: usage(t0) }
    }
    if (!s) return yield* say('Choose a product first, then describe what you need.')
    if (s.status !== 'open') return yield* say('This request is already sent. Comment on its Ticket, or type /request to start another one.')
    const last = a.messages.at(-1)!
    const text = last.content.map((p) => (p.type === 'text' ? p.text : '')).join('\n')
    const offer = async function* (draft: Draft, split: Draft[] | undefined, ready: boolean, missing: string[]): AsyncGenerator<ChatEvent, boolean> {
      const card = confirmCard((s.product as Doc).name, { draft, split, ready, missing })
      const id = `request-${answerId}`
      const input = { session: Number(s.id), ...(split?.length && { expect: split.length }) }
      if (!(await storePending(who, a.thread.id, { toolCallId: id, name: 'submit_request', kind: 'confirm', input, summary: card.title, issuedAt: new Date().toISOString(), card, state: { messages: [], results: [], rounds: 0 } }))) return false
      yield { type: 'tool-call', id, name: 'submit_request', kind: 'confirm', input, summary: card.title }
      yield { type: 'confirm', id, name: 'submit_request', title: card.title, details: card.details, destructive: false, approve: card.approve, decline: card.decline, noReason: card.noReason }
      await finish()
      yield { type: 'done', answerId, requiresAction: true, usage: usage(t0) }
      return true
    }
    if (text.trim() === SEND_TEXT) {
      const card = (await requestCard(who, s.id))!
      if (card.kind === 'question') return yield* say('A question is answered here and files nothing. Press "Turn into a request" on the card to send it.')
      if (!card.canSend) return yield* say(`Not ready to send yet. Still needed: ${card.missing.join(', ')}.`)
      yield { type: 'delta', text: 'Here is what I will send.' }
      if (yield* offer(s.draft as Draft, s.split?.length ? s.split : undefined, !card.missing.length, card.missing)) return
      return yield* say('This request is already waiting for your confirmation.')
    }
    const ids = last.content.flatMap((p) => (p.type === 'image' ? [Number(p.mediaId)] : []))
    const { maxPerSession } = mediaLimits()
    const shots = await exclusive(`intake:${s.id}`, async () => {
      if (!ids.length) return []
      const fresh = (await a.payload.find({ collection: 'media', where: { and: [{ id: { in: ids } }, { workspace: { equals: a.workspace } }, { or: [{ session: { equals: s.id } }, { and: [{ session: { exists: false } }, { product: { exists: false } }, { attached: { equals: false } }] }] }] }, pagination: false, ...o })).docs as Doc[]
      if (fresh.length !== new Set(ids).size) throw new Error('An image is missing or already used in another request.')
      const adopt = fresh.filter((m) => !m.session)
      const have = (await a.payload.findByID({ collection: 'intake_sessions', id: s.id, depth: 0, overrideAccess: true })) as Doc
      if ((have.screenshots ?? 0) + adopt.length > maxPerSession) throw new Error(`At most ${maxPerSession} screenshots per request.`)
      for (const m of adopt) await a.payload.update({ collection: 'media', id: m.id, data: { session: s.id }, ...o })
      if (adopt.length) await a.payload.update({ collection: 'intake_sessions', id: s.id, data: { screenshots: (have.screenshots ?? 0) + adopt.length }, ...o })
      return fresh.map((m) => m.id as number)
    })
    const out = await advanceIntake(a.payload, { user: a.user, token: null }, String(s.id), text, shots)
    yield { type: 'delta', text: out.question }
    if (out.options?.length) yield { type: 'options', id: `options-${answerId}`, options: out.options.map((x) => ({ label: x.label, recommended: !!x.recommended })) }
    const draft = out.draft as Draft
    if ((out.ready || out.exhausted) && draft.type !== 'question' && (yield* offer(draft, out.split as Draft[] | undefined, out.ready, out.missing))) return
    await finish()
    yield { type: 'done', answerId, usage: usage(t0) }
  } catch (e) {
    if (!a.signal?.aborted) yield { type: 'error', message: (e as Error).message }
  } finally {
    if (!answered) await finish().catch(() => {})
  }
}

/** The person's answer to the confirmation card of a request thread (the pending call is already claimed): approving creates the Ticket(s) exactly as stored; declining sends nothing and the interview goes on. */
export async function* resumeRequest(a: { who: Who; ctx: Ctx; thread: Doc; pending: Doc; approved: boolean }): AsyncGenerator<ChatEvent> {
  const t0 = Date.now()
  const { toolCallId, name, input } = a.pending
  const tally: Answer['toolCalls'] = []
  let ok = false
  let text = 'Not sent. Keep describing the request; I will ask again when it is complete.'
  let href: string | undefined
  if (a.approved) {
    try {
      const r = (await runChatTool(a.ctx, name, input)) as { number: number; numbers?: number[] }
      ok = true
      const numbers = r.numbers ?? [r.number]
      text = numbers.length > 1 ? `Requests ${numbers.map((n) => `#${n}`).join(', ')} sent. The factory takes them into Triage.` : `Request #${numbers[0]} sent. The factory takes it into Triage.`
      href = `/requests/${input.session}`
    } catch (e) {
      text = `Not sent: ${(e as Error).message}`
    }
  }
  tally.push({ name, kind: 'confirm', ok })
  yield { type: 'tool-result', id: toolCallId, ok, result: text, ...(href && { href }) }
  const answerId = await startAnswer(a.who, a.thread.id)
  await finishAnswer(a.who, a.thread.id, answerId, { ...usage(t0), toolCalls: tally })
  yield { type: 'done', answerId, usage: usage(t0) }
}
