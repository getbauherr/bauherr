import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { mirrorItem } from '../effects'
import { ProductObserving, TargetNotFound, WrongItemKind } from '../forge/errors'
import { inertBlock, inertName } from '../forge/inert'
import type { ForgeWriter } from '../forge/writer'
import { appendEvent, readRecord } from '../record/store'
import { requestStory } from '../views/request-story'
import { commentFileUrl, postComment, type CommentRole, type NewComment } from './comments'

export type CommentForge = Pick<ForgeWriter, 'commentOnIssue'>
export type Link = { name: string; url: string }

const ROLE_WORDS: Record<CommentRole, string> = { 'product-owner': 'product owner', bauherr: 'Bauherr' }
const REFUSALS = [ProductObserving, TargetNotFound, WrongItemKind]

export const issueCommentBody = (comment: {
  author: string
  role: CommentRole
  text: string
  files: Link[]
  picture: Link | null
}): string => {
  const parts = [`Comment by ${inertName(comment.author)} (${ROLE_WORDS[comment.role]}) in Bauherr:`]
  if (comment.text.trim() !== '') parts.push(inertBlock(comment.text.trim()))
  if (comment.files.length > 0) {
    parts.push(['Files:', ...comment.files.map((file) => `- [${inertName(file.name)}](${file.url})`)].join('\n'))
  }
  if (comment.picture) parts.push(`Picture it refers to: [${inertName(comment.picture.name)}](${comment.picture.url})`)
  return parts.join('\n\n')
}

const pictureOf = async (payload: Payload, workspace: number, recordId: number, base: string): Promise<Link | null> => {
  const story = await requestStory(payload, { workspace, recordId })
  const latest = story.events.findLast((event) => (event.kind === 'plan' || event.kind === 'ready') && event.images[0])
  const image = latest?.images[0]
  return image ? { name: image.caption, url: `${base}/api/attachments/${image.id}` } : null
}

const filesOf = async (payload: Payload, messageId: number, base: string): Promise<Link[]> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT "id", "conversation_id", "name" FROM "conversation_files" WHERE "message_id" = ${messageId} ORDER BY "id"`)
  return found.rows.map((row) => {
    const file = { id: Number(row.id), conversationId: Number(row.conversation_id) }
    return { name: String(row.name), url: `${base}${commentFileUrl(file)}` }
  })
}

export type CommentDeps = { payload: Payload; forge: CommentForge | undefined; baseUrl: string }

export const sendToIssue = async (deps: CommentDeps, comment: NewComment, messageId: number): Promise<void> => {
  const { payload, forge, baseUrl } = deps
  if (!forge) return
  const stored = await readRecord(payload, comment.recordId)
  const itemId = await mirrorItem(payload, stored, 'issue', stored.record.source.number)
  if (itemId === null) return
  const body = issueCommentBody({
    author: comment.author,
    role: comment.role,
    text: comment.text,
    files: await filesOf(payload, messageId, baseUrl),
    picture: await pictureOf(payload, comment.workspace, comment.recordId, baseUrl),
  })
  try {
    await forge.commentOnIssue({ recordId: comment.recordId, itemId }, { key: String(messageId), body })
  } catch (error) {
    if (!(error instanceof Error) || !REFUSALS.some((refusal) => error instanceof refusal)) return
    const { repo, number } = stored.record.source
    const data = { kind: 'comment' as const, target: { repo, number }, reason: error.message.trim() || error.name }
    await appendEvent(payload, comment.recordId, { type: 'forge.write.failed', data, actor: 'factory' })
  }
}

export const commentOnRequest = async (deps: CommentDeps, comment: NewComment): Promise<void> => {
  const event = await postComment(deps.payload, comment)
  await sendToIssue(deps, comment, event.data.messageId)
}
