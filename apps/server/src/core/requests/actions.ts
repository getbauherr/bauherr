import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import type { ForgeWriter } from '../forge/writer'
import type { CommentRole } from './comments'
import { RequestInvalid } from './errors'
import { inertBlock } from './markdown'
import { loadDraft, saveDraft, type Draft } from './store'
import type { RecordType } from '../record/schema'

const openDraft = async (payload: Payload, conversationId: number): Promise<Draft> => {
  const draft = await loadDraft(payload, conversationId)
  if (!draft) throw new RequestInvalid('This request does not exist.')
  if (draft.state !== 'open') throw new RequestInvalid('This request is already finished.')
  return draft
}

const WHO_JOINS: Record<CommentRole, string> = { 'product-owner': 'Another product owner', bauherr: 'The Bauherr' }

export const joinExisting = async (
  payload: Payload,
  deps: { writer: Pick<ForgeWriter, 'commentOnIssue'> },
  conversationId: number,
  role: CommentRole,
): Promise<void> => {
  const draft = await openDraft(payload, conversationId)
  const { offer } = draft.data
  if (!offer) throw new RequestInvalid('There is no open request to join.')
  await deps.writer.commentOnIssue(
    { workspace: draft.workspace, product: draft.product },
    offer.number,
    `${WHO_JOINS[role]} has the same request: ${inertBlock(draft.data.title || draft.data.summary)}`,
  )
  const known = await payload.db.drizzle.execute(sql`
    SELECT "id" FROM "records" WHERE "product_id" = ${draft.product} AND "source_number" = ${offer.number}
    ORDER BY "id" LIMIT 1`)
  const found = known.rows[0] as { id: unknown } | undefined
  await saveDraft(payload, conversationId, {
    state: 'joined',
    data: { ...draft.data, joined: offer },
    issueNumber: offer.number,
    ...(found ? { recordId: Number(found.id) } : {}),
  })
}

export const closeRequest = async (payload: Payload, conversationId: number): Promise<void> => {
  await openDraft(payload, conversationId)
  await saveDraft(payload, conversationId, { state: 'closed' })
}

export const chooseType = async (payload: Payload, conversationId: number, type: RecordType): Promise<void> => {
  const draft = await openDraft(payload, conversationId)
  await saveDraft(payload, conversationId, {
    data: { ...draft.data, type, typeConfirmed: true, answer: null, questions: [] },
  })
}
