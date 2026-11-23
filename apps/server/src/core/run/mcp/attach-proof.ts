import { sql } from '@payloadcms/db-postgres'
import { z } from 'zod'
import { IMAGE_TYPES, type AttachmentKind } from '../../attachments/image'
import { requestUpload } from '../../attachments/store'
import { readRecord, type StoredRecord } from '../../record/store'
import { ProofRefused } from '../errors'
import { authorize } from '../leases'
import type { Run } from '../schema'
import { defineTool, type AgentContext, leaseToken, ownRun, runId } from './tool'

export const PROOF_KINDS = ['screenshot', 'recording', 'output', 'link', 'mockup'] as const
export const BODY_MAX = 20_000

const upload = z.strictObject({
  contentType: z.enum(IMAGE_TYPES),
  caption: z.string().trim().min(1).max(200),
})

const input = z
  .strictObject({
    runId,
    leaseToken,
    criterion: z.string().trim().min(1).optional(),
    kind: z.enum(PROOF_KINDS),
    sha: z.string().trim().min(1).max(100).optional(),
    body: z.string().min(1).max(BODY_MAX).optional(),
    url: z.url().max(2000).optional(),
    upload: upload.optional(),
  })
  .superRefine((value, ctx) => {
    const forms = [value.body, value.url, value.upload].filter((form) => form !== undefined).length
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message })
    if (forms !== 1) issue('give exactly one of body, url and upload')
    if (value.upload && value.kind !== 'mockup' && value.kind !== 'screenshot') {
      issue('an upload is a mockup or a screenshot')
    }
    if (value.kind === 'mockup' && (value.criterion !== undefined || value.sha !== undefined || !value.upload)) {
      issue('a mockup is an upload and has no criterion and no sha')
    }
  })

type Input = z.infer<typeof input>
type Criteria = { id: string }[]
type UploadInput = Input & { kind: AttachmentKind; upload: NonNullable<Input['upload']> }

const proofFields = (value: Input, recordId: number, criteria: Criteria) => {
  if (value.criterion === undefined || value.sha === undefined) {
    throw new ProofRefused('Give the criterion and the sha of the proof.')
  }
  if (!criteria.some((criterion) => criterion.id === value.criterion)) {
    throw new ProofRefused(`Record ${recordId} has no criterion ${value.criterion}: use an id from the record.`)
  }
  return { criterion: value.criterion, sha: value.sha }
}

const isUpload = (value: Input): value is UploadInput =>
  value.upload !== undefined && (value.kind === 'mockup' || value.kind === 'screenshot')

const requestAddress = async (value: UploadInput, context: AgentContext, run: Run, stored: StoredRecord) => {
  const proof = value.kind === 'mockup' ? null : proofFields(value, run.recordId, stored.record.criteria)
  const requested = await requestUpload(context.deps.payload, {
    workspace: stored.workspace,
    recordId: run.recordId,
    runId: run.id,
    stage: run.stage,
    leaseToken: value.leaseToken,
    kind: value.kind,
    caption: value.upload.caption,
    contentType: value.upload.contentType,
    criterion: proof?.criterion ?? null,
    proofSha: proof?.sha ?? null,
    now: context.deps.now,
  })
  return { uploadUrl: `${context.origin}/api/attachments/upload/${requested.token}`, expiresAt: requested.expiresAt }
}

const storeProof = async (value: Input, context: AgentContext, run: Run, stored: StoredRecord) => {
  const proof = proofFields(value, run.recordId, stored.record.criteria)
  const inserted = await context.deps.payload.db.drizzle.execute(sql`
    INSERT INTO "proofs" ("workspace_id", "record_id", "criterion", "kind", "source", "sha", "body", "url",
      "updated_at", "created_at")
    VALUES (${stored.workspace}, ${run.recordId}, ${proof.criterion}, ${value.kind}, 'session', ${proof.sha},
      ${value.body ?? null}, ${value.url ?? null}, now(), now())
    RETURNING "id"`)
  return { proofId: z.coerce.number().parse(inserted.rows[0]?.id) }
}

export const attachProof = defineTool({
  name: 'attach_proof',
  description:
    'Stores a proof for one criterion of the record of your run, as text or a URL, and returns the proof id. ' +
    'With upload (a mockup or a screenshot, PNG, JPEG or WebP, at most 2 MB) it returns { uploadUrl, expiresAt }; ' +
    'then send the file yourself: curl -X PUT --data-binary @shot.png -H "Content-Type: image/png" "<uploadUrl>".',
  access: 'agent',
  input,
  run: async (value, context) => {
    const { payload } = context.deps
    await ownRun(context, value.runId)
    const run = await authorize(payload, value.runId, value.leaseToken)
    const stored = await readRecord(payload, run.recordId)
    return isUpload(value) ? requestAddress(value, context, run, stored) : storeProof(value, context, run, stored)
  },
})
