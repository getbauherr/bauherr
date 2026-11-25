import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { mirrorItem } from '../effects'
import type { ForgeWriter } from '../forge/writer'
import { appendEvent, readRecord } from '../record/store'
import { requestStory } from '../views/request-story'
import { postComment, type CommentRole, type NewComment } from './comments'
import { inertBlock, publicFileUrl, publicPictureUrl } from './markdown'

export type CommentForge = Pick<ForgeWriter, 'commentOnTicket'>
export type Link = { name: string; url: string }
type Signer = (conversationId: number, fileId: number) => string

const NAMELESS: Record<CommentRole, string> = { 'product-owner': 'A product owner', bauherr: 'The Bauherr' }
const ROLE_WORDS: Record<CommentRole, string> = { 'product-owner': 'product owner', bauherr: 'Bauherr' }

export const issueCommentBody = (comment: {
  author: string | null
  role: CommentRole
  text: string
  files: Link[]
  picture: Link | null
}): string => {
  const who = comment.author ? `${inertBlock(comment.author)} (${ROLE_WORDS[comment.role]})` : NAMELESS[comment.role]
  const parts = [`Comment by ${who} in Bauherr:`]
  if (comment.text.trim() !== '') parts.push(inertBlock(comment.text.trim()))
  if (comment.files.length > 0) {
    parts.push(['Files:', ...comment.files.map((file) => `- [${inertBlock(file.name)}](${file.url})`)].join('\n'))
  }
  if (comment.picture) parts.push(`Picture it refers to: [${inertBlock(comment.picture.name)}](${comment.picture.url})`)
  return parts.join('\n\n')
}

const pictureOf = async (
  payload: Payload,
  workspace: number,
  recordId: number,
  sign: (attachmentId: number) => string,
): Promise<Link | null> => {
  const story = await requestStory(payload, { workspace, recordId })
  const latest = story.events.findLast((event) => (event.kind === 'plan' || event.kind === 'ready') && event.images[0])
  const image = latest?.images[0]
  return image ? { name: image.caption, url: sign(image.id) } : null
}

const filesOf = async (payload: Payload, messageId: number, link: Signer): Promise<Link[]> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT "id", "conversation_id", "name" FROM "conversation_files" WHERE "message_id" = ${messageId} ORDER BY "id"`)
  return found.rows.map((row) => {
    const url = link(Number(row.conversation_id), Number(row.id))
    return { name: String(row.name), url }
  })
}

export type CommentDeps = { payload: Payload; forge: CommentForge | undefined; origin: string; key: string }

export const sendToIssue = async (deps: CommentDeps, comment: NewComment, messageId: number): Promise<void> => {
  const { payload, forge, origin, key } = deps
  if (!forge) return
  const stored = await readRecord(payload, comment.recordId)
  const itemId = await mirrorItem(payload, stored, 'issue', stored.record.source.number)
  if (itemId === null) return
  const signer: Signer = (conversation, file) => publicFileUrl(origin, key, conversation, file)
  const body = issueCommentBody({
    author: null,
    role: comment.role,
    text: comment.text,
    files: await filesOf(payload, messageId, signer),
    picture: await pictureOf(payload, comment.workspace, comment.recordId, (id) =>
      publicPictureUrl(origin, key, comment.recordId, id),
    ),
  })
  try {
    await forge.commentOnTicket({ recordId: comment.recordId, itemId }, { key: String(messageId), body })
  } catch (error) {
    const { repo, number } = stored.record.source
    const text = error instanceof Error ? error.message.trim() || error.name : String(error)
    const data = { kind: 'comment' as const, target: { repo, number }, reason: `Comment message ${messageId}: ${text}` }
    await appendEvent(payload, comment.recordId, { type: 'forge.write.failed', data, actor: 'factory' })
  }
}

export const commentOnRequest = async (deps: CommentDeps, comment: NewComment): Promise<void> => {
  const event = await postComment(deps.payload, comment)
  await sendToIssue(deps, comment, event.data.messageId)
}
