import { sql } from '@payloadcms/db-postgres'
import { z } from 'zod'
import { UploadRefused } from '../attachments/image'
import type { Conn } from '../conn'
import { MESSAGE_FILES_MAX, MESSAGE_TEXT_MAX } from './limits'

const count = z.coerce.number()

export type StoredFile = { id: number; name: string; contentType: string; bytes: number }
export type ConversationMessage = {
  id: number
  role: 'user' | 'assistant'
  text: string
  createdAt: string
  files: StoredFile[]
}

export type NewFile = {
  workspace: number
  conversationId: number
  name: string
  contentType: string
  bytes: Uint8Array
}
export type NewMessage = {
  workspace: number
  conversationId: number
  role: ConversationMessage['role']
  text: string
  fileIds: number[]
}

const idRow = z.object({ id: count })

export const createConversation = async (
  db: Conn,
  workspace: number,
  title: string,
  recordId: number | null = null,
): Promise<number> => {
  const found = await db.db.drizzle.execute(sql`
    INSERT INTO "conversations" ("workspace_id", "title", "record_id", "updated_at", "created_at")
    VALUES (${workspace}, ${title}, ${recordId}, now(), now()) RETURNING "id"`)
  return idRow.parse(found.rows[0]).id
}

export const conversationWorkspace = async (db: Conn, id: number): Promise<number | null> => {
  const found = await db.db.drizzle.execute(sql`SELECT "workspace_id" FROM "conversations" WHERE "id" = ${id}`)
  return found.rows[0] ? count.parse(z.object({ workspace_id: z.unknown() }).parse(found.rows[0]).workspace_id) : null
}

export const conversationRecord = async (db: Conn, id: number): Promise<number | null> => {
  const found = await db.db.drizzle.execute(sql`SELECT "record_id" FROM "conversations" WHERE "id" = ${id}`)
  const row = z.object({ record_id: count.nullable() }).safeParse(found.rows[0])
  return row.success ? row.data.record_id : null
}

export const storeFile = async (db: Conn, file: NewFile): Promise<StoredFile> => {
  const content = Buffer.from(file.bytes).toString('base64')
  const found = await db.db.drizzle.execute(sql`
    INSERT INTO "conversation_files" ("workspace_id", "conversation_id", "name", "content_type", "byte_size", "content",
      "updated_at", "created_at")
    VALUES (${file.workspace}, ${file.conversationId}, ${file.name}, ${file.contentType}, ${file.bytes.length},
      ${content}, now(), now()) RETURNING "id"`)
  return { id: idRow.parse(found.rows[0]).id, name: file.name, contentType: file.contentType, bytes: file.bytes.length }
}

const attach = async (db: Conn, message: NewMessage, messageId: number): Promise<void> => {
  if (message.fileIds.length === 0) return
  const found = await db.db.drizzle.execute(sql`
    UPDATE "conversation_files" SET "message_id" = ${messageId}, "updated_at" = now()
    WHERE "conversation_id" = ${message.conversationId} AND "message_id" IS NULL
      AND "id" IN (${sql.join(message.fileIds.map((id) => sql`${id}`), sql`, `)})
    RETURNING "id"`)
  if (found.rows.length !== new Set(message.fileIds).size) {
    throw new UploadRefused('An attached file is unknown or already sent.', 409)
  }
}

export const appendMessage = async (db: Conn, message: NewMessage): Promise<number> => {
  if (message.text.length > MESSAGE_TEXT_MAX) throw new UploadRefused('The message is too long.', 413)
  if (message.fileIds.length > MESSAGE_FILES_MAX) throw new UploadRefused('Too many files in one message.', 413)
  if (message.text.trim() === '' && message.fileIds.length === 0) throw new UploadRefused('The message is empty.', 400)
  const found = await db.db.drizzle.execute(sql`
    INSERT INTO "conversation_messages" ("workspace_id", "conversation_id", "role", "text", "updated_at", "created_at")
    VALUES (${message.workspace}, ${message.conversationId}, ${message.role}, ${message.text}, now(), now())
    RETURNING "id"`)
  const id = idRow.parse(found.rows[0]).id
  await attach(db, message, id)
  return id
}

const messageRow = z.object({
  id: count,
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  created_at: z.coerce.date(),
})
const fileRow = z.object({ id: count, message_id: count, name: z.string(), content_type: z.string(), byte_size: count })

export const listMessages = async (db: Conn, conversationId: number): Promise<ConversationMessage[]> => {
  const messages = await db.db.drizzle.execute(sql`
    SELECT "id", "role", "text", "created_at" FROM "conversation_messages"
    WHERE "conversation_id" = ${conversationId} ORDER BY "id"`)
  const files = await db.db.drizzle.execute(sql`
    SELECT "id", "message_id", "name", "content_type", "byte_size" FROM "conversation_files"
    WHERE "conversation_id" = ${conversationId} AND "message_id" IS NOT NULL ORDER BY "id"`)
  const attached = files.rows.map((row) => fileRow.parse(row))
  return messages.rows.map((row) => {
    const message = messageRow.parse(row)
    return {
      id: message.id,
      role: message.role,
      text: message.text,
      createdAt: message.created_at.toISOString(),
      files: attached
        .filter((file) => file.message_id === message.id)
        .map((file) => ({ id: file.id, name: file.name, contentType: file.content_type, bytes: file.byte_size })),
    }
  })
}

const contentRow = z.object({ name: z.string(), content_type: z.string(), content: z.string() })

export const readFile = async (
  db: Conn,
  conversationId: number,
  fileId: number,
): Promise<{ name: string; contentType: string; bytes: Buffer } | null> => {
  const found = await db.db.drizzle.execute(sql`
    SELECT "name", "content_type", "content" FROM "conversation_files"
    WHERE "id" = ${fileId} AND "conversation_id" = ${conversationId}`)
  if (!found.rows[0]) return null
  const row = contentRow.parse(found.rows[0])
  return { name: row.name, contentType: row.content_type, bytes: Buffer.from(row.content, 'base64') }
}

export type CommentFile = StoredFile & { conversationId: number }

const commentFileRow = z.object({
  id: count,
  conversation_id: count,
  name: z.string(),
  content_type: z.string(),
  byte_size: count,
})

export const commentFilesOf = async (db: Conn, recordId: number): Promise<CommentFile[]> => {
  const found = await db.db.drizzle.execute(sql`
    SELECT f."id", f."conversation_id", f."name", f."content_type", f."byte_size"
    FROM "conversation_files" f JOIN "conversations" c ON c."id" = f."conversation_id"
    WHERE c."record_id" = ${recordId} AND f."message_id" IS NOT NULL ORDER BY f."id"`)
  return found.rows.map((row) => {
    const file = commentFileRow.parse(row)
    return {
      id: file.id,
      conversationId: file.conversation_id,
      name: file.name,
      contentType: file.content_type,
      bytes: file.byte_size,
    }
  })
}

const commentContentRow = contentRow.extend({ byte_size: count })

export const commentFileOf = async (
  db: Conn,
  recordId: number,
  fileId: number,
): Promise<{ name: string; contentType: string; bytes: number; base64: string } | null> => {
  const found = await db.db.drizzle.execute(sql`
    SELECT f."name", f."content_type", f."byte_size", f."content"
    FROM "conversation_files" f JOIN "conversations" c ON c."id" = f."conversation_id"
    WHERE f."id" = ${fileId} AND c."record_id" = ${recordId} AND f."message_id" IS NOT NULL`)
  if (!found.rows[0]) return null
  const row = commentContentRow.parse(found.rows[0])
  return { name: row.name, contentType: row.content_type, bytes: row.byte_size, base64: row.content }
}
