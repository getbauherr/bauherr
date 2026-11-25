import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { appendMessage, createConversation } from '../conversations/store'
import { MESSAGE_FILES_MAX } from '../conversations/limits'
import type { Conn } from '../conn'
import { appendEvent, type StoredEvent } from '../record/store'

export type CommentRole = 'product-owner' | 'bauherr'
export type CommentFileView = { id: number; conversationId: number; name: string; contentType: string }
export type RequestComment = {
  id: number
  at: string
  author: string
  role: CommentRole
  text: string
  files: CommentFileView[]
}

export type NewComment = {
  workspace: number
  recordId: number
  conversationId: number
  text: string
  fileIds: number[]
  author: string
  role: CommentRole
  actorId: string
}

const count = z.coerce.number()
const idRow = z.object({ id: count })
const fileRow = z.object({
  id: count,
  message_id: count,
  conversation_id: count,
  name: z.string(),
  content_type: z.string(),
})

const commentsTitle = (recordId: number): string => `Request ${recordId} comments`

export const findRequestConversation = async (
  payload: Conn,
  workspace: number,
  recordId: number,
): Promise<number | null> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT "id" FROM "conversations"
    WHERE "record_id" = ${recordId} AND "workspace_id" = ${workspace} AND "title" = ${commentsTitle(recordId)}
    ORDER BY "id" LIMIT 1`)
  return found.rows[0] ? idRow.parse(found.rows[0]).id : null
}

export const requestConversation = async (payload: Payload, workspace: number, recordId: number): Promise<number> =>
  (await findRequestConversation(payload, workspace, recordId)) ??
  createConversation(payload, workspace, commentsTitle(recordId), recordId)

const ownsConversation = async (db: Conn, input: NewComment): Promise<boolean> => {
  return (await findRequestConversation(db, input.workspace, input.recordId)) === input.conversationId
}

export class CommentRefused extends Error {}

export type CommentEvent = StoredEvent & { type: 'request.commented' }

export const postComment = (payload: Payload, input: NewComment): Promise<CommentEvent> =>
  payload.db.drizzle.transaction(async (tx) => {
    const db: Conn = { db: { drizzle: tx } }
    if (!(await ownsConversation(db, input))) {
      throw new CommentRefused('This conversation does not belong to the request.')
    }
    if (input.fileIds.length > MESSAGE_FILES_MAX) throw new CommentRefused('Too many files in one comment.')
    const messageId = await appendMessage(db, {
      workspace: input.workspace,
      conversationId: input.conversationId,
      role: 'user',
      text: input.text,
      fileIds: input.fileIds,
    })
    const event = await appendEvent(db, input.recordId, {
      type: 'request.commented',
      data: {
        messageId,
        author: input.author,
        role: input.role,
        text: input.text,
        files: new Set(input.fileIds).size,
      },
      actor: input.role === 'bauherr' ? 'owner' : 'reporter',
      actorId: input.actorId,
    })
    if (event.type !== 'request.commented') throw new CommentRefused('The comment was not stored.')
    return event
  })

export const commentsOf = async (
  payload: Payload,
  recordId: number,
  events: StoredEvent[],
): Promise<RequestComment[]> => {
  const commented = events.flatMap((event) => (event.type === 'request.commented' ? [event] : []))
  if (commented.length === 0) return []
  const found = await payload.db.drizzle.execute(sql`
    SELECT f."id", f."message_id", f."conversation_id", f."name", f."content_type"
    FROM "conversation_files" f JOIN "conversations" c ON c."id" = f."conversation_id"
    WHERE c."record_id" = ${recordId} AND f."message_id" IS NOT NULL ORDER BY f."id"`)
  const files = found.rows.map((row) => fileRow.parse(row))
  return commented.map((event) => ({
    id: event.id,
    at: event.createdAt,
    author: event.data.author,
    role: event.data.role,
    text: event.data.text,
    files: files
      .filter((file) => file.message_id === event.data.messageId)
      .map((file) => ({
        id: file.id,
        conversationId: file.conversation_id,
        name: file.name,
        contentType: file.content_type,
      })),
  }))
}

export const commentFileUrl = (file: Pick<CommentFileView, 'id' | 'conversationId'>): string =>
  `/api/conversations/${file.conversationId}/files/${file.id}`
