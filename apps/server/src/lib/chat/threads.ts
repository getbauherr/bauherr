import { randomUUID } from 'node:crypto'
import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

type Doc = Record<string, any>
/** The acting person in their current Workspace; every function below treats a thread of anyone else as not found. */
export type Who = { payload: Payload; user: Doc; workspace: number }
export type Meta = { id: number; title: string | null; archived: boolean; lastMessageAt: string | null; createdAt: string; context: { path: string; label: string } | null; /** Ticket id of a Ticket thread. */ ticket: number | null; /** A request thread (the intake interview). */ request: boolean }
export type Answer = { model: string; tokensIn: number; tokensOut: number; costUsd: number | null; ms: number; toolCalls: { name: string; kind: string; ok: boolean }[] }

export const LIST_LIMIT = 200
export const MAX_TITLE_CHARS = 60
export const MAX_MESSAGE_BYTES = 2_000_000
export const MAX_NOTE_CHARS = 2000
export const MAX_REASONS = 10
const o = { depth: 0, overrideAccess: true } as const
const run = (w: { payload: Payload }, q: ReturnType<typeof sql>) => w.payload.db.drizzle.execute(q)
const json = (v: unknown) => sql`${JSON.stringify(v)}::jsonb`

export const meta = (t: Doc): Meta => ({ id: t.id, title: t.title ?? null, archived: !!t.archivedAt, lastMessageAt: t.lastMessageAt ?? null, createdAt: t.createdAt, context: t.context ? { path: t.context.path, label: t.context.label } : null, ticket: t.ticket ? (typeof t.ticket === 'object' ? t.ticket.id : t.ticket) : null, request: !!t.request })

/** The thread when it belongs to this person in this Workspace, else null (never a hint that it exists). */
export const ownThread = async (w: Who, id: string | number): Promise<Doc | null> => {
  if (!/^\d+$/.test(String(id))) return null
  const { docs } = await w.payload.find({ collection: 'chat_threads', where: { and: [{ id: { equals: Number(id) } }, { owner: { equals: w.user.id } }, { workspace: { equals: w.workspace } }] }, limit: 1, ...o })
  return docs[0] ?? null
}

/** The helper's threads: the refinement conversations of Tickets (an `intakeSession` without `request`) belong to their panel and are not listed. */
export const listThreads = async (w: Who, { archived = false }: { archived?: boolean } = {}): Promise<Meta[]> =>
  (await w.payload.find({ collection: 'chat_threads', where: { and: [{ owner: { equals: w.user.id } }, { workspace: { equals: w.workspace } }, { archivedAt: { exists: archived } }, { or: [{ request: { equals: true } }, { intakeSession: { exists: false } }] }] }, sort: '-lastMessageAt', limit: LIST_LIMIT, pagination: false, ...o })).docs.map(meta)

export const createThread = async (w: Who, context?: { path: string; label: string }): Promise<Meta> =>
  meta(await w.payload.create({ collection: 'chat_threads', data: { owner: w.user.id, workspace: w.workspace, context, lastMessageAt: new Date().toISOString() }, ...o }))

/** The person's one thread of a Ticket of this Workspace, created (named "#<number> <title>") or brought back from the archive; null when the Ticket is not in the Workspace. */
export const ticketThread = async (w: Who, ticketId: number | string): Promise<Meta | null> => {
  if (!/^\d+$/.test(String(ticketId))) return null
  const t = (await w.payload.find({ collection: 'tickets', where: { and: [{ id: { equals: Number(ticketId) } }, { workspace: { equals: w.workspace } }] }, limit: 1, select: { number: true, title: true }, ...o })).docs[0] as Doc | undefined
  if (!t) return null
  const find = async () => (await w.payload.find({ collection: 'chat_threads', where: { and: [{ owner: { equals: w.user.id } }, { workspace: { equals: w.workspace } }, { ticket: { equals: t.id } }] }, limit: 1, ...o })).docs[0] as Doc | undefined
  const found = (await find()) ?? (await w.payload
    .create({ collection: 'chat_threads', data: { owner: w.user.id, workspace: w.workspace, ticket: t.id, title: `#${t.number} ${t.title}`.slice(0, 120), context: { path: `/tickets/${t.id}`, label: `Ticket #${t.number} ${t.title}` }, lastMessageAt: new Date().toISOString() }, ...o })
    .catch(find))
  if (!found) return null
  return meta(found.archivedAt ? await w.payload.update({ collection: 'chat_threads', id: found.id, data: { archivedAt: null }, ...o }) : found)
}

export const updateThread = async (w: Who, id: string, patch: { title?: string | null; archived?: boolean }): Promise<Meta | null> => {
  const t = await ownThread(w, id)
  if (!t) return null
  const data: Doc = {}
  if (patch.title !== undefined) data.title = patch.title?.trim().slice(0, 120) || null
  if (patch.archived !== undefined) data.archivedAt = patch.archived ? (t.archivedAt ?? new Date().toISOString()) : null
  return meta(await w.payload.update({ collection: 'chat_threads', id: t.id, data, ...o }))
}

export const deleteThread = async (w: Who, id: string): Promise<boolean> => {
  const t = await ownThread(w, id)
  if (!t) return false
  await run(w, sql`DELETE FROM "chat_messages" WHERE "thread_id" = ${t.id}`)
  await w.payload.delete({ collection: 'chat_threads', id: t.id, ...o })
  return true
}

/** The thread's stored messages (the client's exported shape, oldest first) for ThreadHistoryAdapter.load; answers the server issued but the client never stored are skipped. */
export const loadMessages = async (w: Who, id: string) => {
  const t = await ownThread(w, id)
  if (!t) return null
  const { docs } = await w.payload.find({ collection: 'chat_messages', where: { and: [{ thread: { equals: t.id } }, { message: { exists: true } }] }, sort: 'createdAt', pagination: false, ...o })
  return {
    context: t.context ?? null,
    ticket: meta(t).ticket,
    pending: t.pending ? { toolCallId: t.pending.toolCallId, name: t.pending.name, kind: t.pending.kind, input: t.pending.input, summary: t.pending.summary, ...t.pending.card } : null,
    messages: docs.map((m: Doc) => ({ parentId: m.parentId ?? null, message: m.message, answer: m.answer ?? null, feedback: m.feedback ? { value: m.feedback, reasons: m.feedbackReasons ?? [], note: m.feedbackNote ?? null } : null })),
  }
}

/** First text of an exported assistant-ui message, one line. */
export const textOf = (message: Doc | null | undefined): string =>
  ((message?.content as Doc[] | undefined) ?? []).filter((p) => p?.type === 'text' && typeof p.text === 'string').map((p) => p.text).join('\n')

/** Upserts one exported message by (thread, message id) in one statement, so a retried save is a no-op. An assistant message carrying `answerId` takes over the row the server issued for that answer (its usage and feedback). The first user text names an untitled thread. */
export const upsertMessage = async (w: Who, id: string, a: { parentId?: string | null; message: Doc; answerId?: string }): Promise<boolean> => {
  const t = await ownThread(w, id)
  const m = a.message
  if (!t) return false
  if (!m || typeof m.id !== 'string' || !m.id || m.id.length > 64 || !['user', 'assistant'].includes(m.role) || !Array.isArray(m.content)) throw new Error('message needs id, role and content')
  if (JSON.stringify(m).length > MAX_MESSAGE_BYTES) throw new Error('message too large')
  if (a.answerId && m.role === 'assistant') {
    await run(w, sql`UPDATE "chat_messages" SET "message_id" = ${m.id}, "parent_id" = ${a.parentId ?? null}, "message" = ${json(m)}, "created_at" = now(), "updated_at" = now() WHERE "thread_id" = ${t.id} AND "message_id" = ${a.answerId} AND "message" IS NULL AND NOT EXISTS (SELECT 1 FROM "chat_messages" WHERE "thread_id" = ${t.id} AND "message_id" = ${m.id})`)
  }
  await run(w, sql`INSERT INTO "chat_messages" ("workspace_id", "thread_id", "message_id", "parent_id", "message", "role") VALUES (${w.workspace}, ${t.id}, ${m.id}, ${a.parentId ?? null}, ${json(m)}, ${m.role}) ON CONFLICT ("thread_id", "message_id") DO UPDATE SET "parent_id" = EXCLUDED."parent_id", "message" = EXCLUDED."message", "role" = EXCLUDED."role", "updated_at" = now()`)
  const name = m.role === 'user' ? textOf(m).replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_CHARS) : ''
  await run(w, sql`UPDATE "chat_threads" SET "last_message_at" = now(), "title" = CASE WHEN ("title" IS NULL OR "title" = '') AND ${name}::text <> '' THEN ${name}::text ELSE "title" END, "updated_at" = now() WHERE "id" = ${t.id}`)
  return true
}

/** Remembers the page of the last message. */
export const setContext = async (w: Who, threadId: number, context: { path: string; label: string }): Promise<void> => {
  await run(w, sql`UPDATE "chat_threads" SET "context" = ${json(context)}, "last_message_at" = now(), "updated_at" = now() WHERE "id" = ${threadId}`)
}

/** Runs this person started in the last hour (one row per answer the server issued). */
export const recentRuns = async (w: Who): Promise<number> =>
  (await w.payload.count({ collection: 'chat_messages', where: { and: [{ 'thread.owner': { equals: w.user.id } }, { role: { equals: 'assistant' } }, { createdAt: { greater_than: new Date(Date.now() - 3_600_000).toISOString() } }] }, overrideAccess: true })).totalDocs

/** Issues the server-side id of the answer about to be streamed. */
export const startAnswer = async (w: Who, threadId: number): Promise<string> => {
  const answerId = randomUUID()
  await run(w, sql`INSERT INTO "chat_messages" ("workspace_id", "thread_id", "message_id", "role") VALUES (${w.workspace}, ${threadId}, ${answerId}, 'assistant')`)
  return answerId
}

export const finishAnswer = async (w: Who, threadId: number, answerId: string, answer: Answer): Promise<void> => {
  await run(w, sql`UPDATE "chat_messages" SET "answer" = ${json(answer)}, "updated_at" = now() WHERE "thread_id" = ${threadId} AND "message_id" = ${answerId}`)
}

/** Rates one answer of the thread; `messageId` is the client's message id (or the answerId before the client stored it). `value` null withdraws the rating. */
export const setFeedback = async (w: Who, id: string, a: { messageId: string; value: 'up' | 'down' | null; reasons?: string[]; note?: string }): Promise<boolean> => {
  const t = await ownThread(w, id)
  if (!t || typeof a.messageId !== 'string') return false
  const [m] = (await w.payload.find({ collection: 'chat_messages', where: { and: [{ thread: { equals: t.id } }, { messageId: { equals: a.messageId } }, { role: { equals: 'assistant' } }] }, limit: 1, ...o })).docs
  if (!m) return false
  const on = a.value === 'up' || a.value === 'down'
  const reasons = Array.isArray(a.reasons) ? a.reasons.filter((r) => typeof r === 'string' && r.trim()).map((r) => r.trim().slice(0, 100)).slice(0, MAX_REASONS) : []
  await w.payload.update({ collection: 'chat_messages', id: m.id, data: { feedback: on ? a.value : null, feedbackReasons: on ? reasons : null, feedbackNote: on ? (a.note ?? '').slice(0, MAX_NOTE_CHARS) || null : null, feedbackAt: on ? new Date().toISOString() : null }, ...o })
  return true
}

/** Stores the one tool call awaiting confirmation; false when the thread already has one (the conditional UPDATE is the state guard). */
export const storePending = async (w: Who, threadId: number, pending: Doc): Promise<boolean> =>
  (await run(w, sql`UPDATE "chat_threads" SET "pending" = ${json(pending)}, "updated_at" = now() WHERE "id" = ${threadId} AND "pending" IS NULL RETURNING "id"`)).rows.length > 0

/** Takes the pending call out of the thread in one statement: only the call whose id matches, and only once (a double click gets null). */
export const claimPending = async (w: Who, threadId: number, toolCallId: string): Promise<Doc | null> =>
  ((await run(w, sql`WITH old AS (SELECT "pending" FROM "chat_threads" WHERE "id" = ${threadId} AND "pending"->>'toolCallId' = ${toolCallId} FOR UPDATE) UPDATE "chat_threads" t SET "pending" = NULL, "updated_at" = now() FROM old WHERE t."id" = ${threadId} RETURNING old."pending" AS "pending"`)).rows[0]?.pending as Doc | undefined) ?? null

/** A new message supersedes an unanswered confirmation. */
export const dropPending = async (w: Who, threadId: number): Promise<void> => {
  await run(w, sql`UPDATE "chat_threads" SET "pending" = NULL, "updated_at" = now() WHERE "id" = ${threadId} AND "pending" IS NOT NULL`)
}
