import type { Payload } from 'payload'
import { exclusive } from '../actions'
import { modelFor, ownSession, type Who } from './api'
import { laneOn } from '../expedite'
import { cardColumns, changedFields, nextTurn, type CardField, type Session, type TurnHooks } from './engine'
import { mediaBytes } from './media'

type Doc = Record<string, any>
/** `changed`: the card fields this turn changed (the request conversation marks them). */
export type TurnOut = { question: string; options?: { label: string; recommended?: boolean }[]; draft: unknown; split?: unknown; ready: boolean; exhausted: boolean; missing: string[]; changed: CardField[] }

/** One interview turn of an open session the caller already owns (and holds the `intake:<id>` lock for); stores the new state and returns the turn. Throws on an unknown or already sent screenshot or a refused message. */
export const advance = async (payload: Payload, s: Doc, text: string, images: unknown[], hooks: TurnHooks = {}): Promise<TurnOut> => {
  const state: Session = { messages: s.messages ?? [], draft: s.draft ?? null, split: s.split ?? undefined, screenshots: s.screenshots, edited: s.edited ?? undefined }
  const sent = new Set(state.messages.flatMap((m) => m.images ?? []).map(String))
  const found = images.length ? (await payload.find({ collection: 'media', where: { and: [{ session: { equals: s.id } }, { id: { in: images } }] }, pagination: false, depth: 0, overrideAccess: true })).docs : []
  if (found.length !== new Set(images.map(String)).size || found.some((m) => sent.has(String(m.id)))) throw new Error('unknown or already sent screenshot')
  const lane = await laneOn(payload, typeof s.workspace === 'object' ? s.workspace.id : s.workspace)
  const { session, turn, ready, exhausted, missing } = await nextTurn(state, text, await modelFor(payload, s), await Promise.all(found.map(async (m) => ({ id: m.id, mime: (m.mime ?? m.mimeType) as string, data: Buffer.from(await mediaBytes(payload, m)).toString('base64') }))), lane, hooks)
  hooks.signal?.throwIfAborted()
  const out: TurnOut = { question: turn.question, options: turn.options, draft: turn.draft, split: turn.split, ready, exhausted, missing, changed: changedFields(state.draft, turn.draft) }
  await payload.update({ collection: 'intake_sessions', id: s.id, data: { messages: session.messages, draft: session.draft, ...cardColumns(session.draft), split: session.split ?? null, turn: out }, overrideAccess: true })
  return out
}

/** One interview turn of an open session of the caller's (`images`: ids of this session's screenshots not yet sent). Throws on an unknown session. */
export const advanceIntake = (payload: Payload, who: Who, id: string, text: string, images: unknown[], hooks: TurnHooks = {}): Promise<TurnOut> =>
  exclusive(`intake:${id}`, async () => {
    const s = await ownSession(payload, who, id)
    if (!s || s.status !== 'open') throw new Error('session not found')
    return advance(payload, s, text, images, hooks)
  })
