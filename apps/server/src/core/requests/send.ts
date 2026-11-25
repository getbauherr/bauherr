import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import type { Conn } from '../conn'
import type { ForgeWriter } from '../forge/writer'
import { appendEvent, createRecord, readEvents } from '../record/store'
import { RequestInvalid } from './errors'
import { FIELDS, readiness, TYPE_WORDS, type Fields } from './fields'
import { filesOf, loadDraft, saveDraft, type Draft, type DraftFile } from './store'

export type SendDeps = { writer: Pick<ForgeWriter, 'openIssue'>; origin: string }
export type Sent = { issueNumber: number; recordId: number }

export const referenceOf = (conversationId: number): string => `bauherr-request-${conversationId}`

export const titleOf = (draft: Draft): string => {
  const first = Object.values(draft.data.fields).find((value) => value.trim() !== '') ?? 'New request'
  return (draft.data.title || first).slice(0, 120)
}

export const bodyOf = (draft: Draft, files: DraftFile[], origin: string): string => {
  const { type, fields, summary } = draft.data
  if (type === null) throw new RequestInvalid('The request has no type yet.')
  const sections = FIELDS[type].flatMap((field) => {
    const value = (fields as Fields)[field.key]?.trim()
    return value ? [`## ${field.label}\n\n${value}`] : []
  })
  const attached = files.map(
    (file) => `- [${file.name}](${origin}/api/conversations/${draft.conversationId}/files/${file.id})`,
  )
  return [
    `Type: ${TYPE_WORDS[type]}`,
    `## Summary\n\n${summary || titleOf(draft)}`,
    ...sections,
    ...(attached.length > 0 ? [`## Files\n\n${attached.join('\n')}`] : []),
  ].join('\n\n')
}

const sourceRow = z.object({ kind: z.enum(['github', 'gitlab']), repo: z.string() })

const sourceOf = async (db: Conn, workspace: number, product: number) => {
  const found = await db.db.drizzle.execute(sql`
    SELECT c."kind"::text AS kind, s."repo" FROM "ticket_sources" s JOIN "connections" c ON c."id" = s."connection_id"
    WHERE s."product_id" = ${product} AND s."workspace_id" = ${workspace} ORDER BY s."id" LIMIT 1`)
  if (!found.rows[0]) throw new RequestInvalid('This product has no repository yet: connect one first.')
  return sourceRow.parse(found.rows[0])
}

export const sendRequest = async (
  payload: Payload,
  deps: SendDeps,
  input: { conversationId: number; reporter: string },
): Promise<Sent> =>
  payload.db.drizzle.transaction(async (tx) => {
    const db: Conn = { db: { drizzle: tx } }
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('request'), ${input.conversationId})`)
    const draft = await loadDraft(db, input.conversationId, true)
    if (!draft) throw new RequestInvalid('This request does not exist.')
    if (draft.state === 'sent' && draft.issueNumber !== null && draft.recordId !== null) {
      return { issueNumber: draft.issueNumber, recordId: draft.recordId }
    }
    const { type } = draft.data
    if (draft.state !== 'open' || type === null) throw new RequestInvalid('This request cannot be sent.')
    if (type === 'question') {
      throw new RequestInvalid('A question is answered here: close it, or turn it into a bug or a change first.')
    }
    const { complete, missing } = readiness(type, draft.data.fields)
    if (!complete) throw new RequestInvalid(`Still missing: ${missing.map((m) => m.label).join(', ')}.`)
    const where = { workspace: draft.workspace, product: draft.product }
    const issue = await deps.writer.openIssue(where, {
      title: titleOf(draft),
      body: bodyOf(draft, await filesOf(db, draft.conversationId), deps.origin),
      reference: referenceOf(draft.conversationId),
    })
    const { kind, repo } = await sourceOf(db, draft.workspace, draft.product)
    const stored = await createRecord(db, {
      ...where,
      type,
      source: { forge: kind, repo, number: issue.number, reporter: input.reporter, external: true, backlog: false },
    })
    if ((await readEvents(db, stored.id)).length === 0) {
      await appendEvent(db, stored.id, { type: 'intake.accepted', data: {}, actor: 'factory' })
    }
    await saveDraft(db, draft.conversationId, { state: 'sent', issueNumber: issue.number, recordId: stored.id })
    return { issueNumber: issue.number, recordId: stored.id }
  })
