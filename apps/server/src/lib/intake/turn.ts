import type { Payload } from 'payload'
import { exclusive } from '../actions'
import { modelFor, ownSession, type Who } from './api'
import { nextTurn, type Session } from './engine'
import { mediaBytes } from './media'

export type TurnOut = { question: string; options?: { label: string; recommended?: boolean }[]; draft: unknown; split?: unknown; ready: boolean; exhausted: boolean; missing: string[] }

/** One interview turn of an open session (`images`: ids of this session's screenshots not yet sent); stores the new state and returns the turn. Throws on an unknown session, an unknown or already sent screenshot, or a refused message. */
export const advanceIntake = (payload: Payload, who: Who, id: string, text: string, images: unknown[]): Promise<TurnOut> =>
  exclusive(`intake:${id}`, async () => {
    const s = await ownSession(payload, who, id)
    if (!s || s.status !== 'open') throw new Error('session not found')
    const state: Session = { messages: s.messages ?? [], draft: s.draft ?? null, split: s.split ?? undefined, screenshots: s.screenshots }
    const sent = new Set(state.messages.flatMap((m) => m.images ?? []).map(String))
    const found = images.length ? (await payload.find({ collection: 'media', where: { and: [{ session: { equals: s.id } }, { id: { in: images } }] }, pagination: false, depth: 0, overrideAccess: true })).docs : []
    if (found.length !== new Set(images.map(String)).size || found.some((m) => sent.has(String(m.id)))) throw new Error('unknown or already sent screenshot')
    const { session, turn, ready, exhausted, missing } = await nextTurn(state, text, await modelFor(payload, s), await Promise.all(found.map(async (m) => ({ id: m.id, mime: (m.mime ?? m.mimeType) as string, data: Buffer.from(await mediaBytes(payload, m)).toString('base64') }))))
    const out: TurnOut = { question: turn.question, options: turn.options, draft: turn.draft, split: turn.split, ready, exhausted, missing }
    await payload.update({ collection: 'intake_sessions', id: s.id, data: { messages: session.messages, draft: session.draft, split: session.split ?? null, turn: out }, overrideAccess: true })
    return out
  })
