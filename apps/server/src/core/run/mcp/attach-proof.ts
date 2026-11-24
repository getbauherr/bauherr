import { sql } from '@payloadcms/db-postgres'
import { z } from 'zod'
import { ATTACHMENT_TYPES, type AttachmentKind } from '../../attachments/image'
import { requestUpload } from '../../attachments/store'
import { inputIssues } from './attach-rules'
import { loadMockups } from '../../views/attachments'
import { readRecord, type StoredRecord } from '../../record/store'
import { ProofRefused } from '../errors'
import { authorize } from '../leases'
import type { Run } from '../schema'
import { defineTool, type AgentContext, leaseToken, ownRun, runId } from './tool'

export const PROOF_KINDS = ['screenshot', 'recording', 'output', 'link', 'mockup', 'before', 'after'] as const
export const BODY_MAX = 20_000
export const ONE_FORM = 'give either body, url or upload, not both; a link with an explanation goes into body'

const upload = z.strictObject({
  contentType: z.enum(ATTACHMENT_TYPES),
  caption: z.string().trim().min(1).max(200),
})

const input = z
  .strictObject({
    runId,
    leaseToken,
    criterion: z.string().trim().min(1).optional(),
    kind: z.enum(PROOF_KINDS),
    sha: z.string().trim().min(1).max(100).optional(),
    body: z.string().min(1).max(BODY_MAX).optional().describe(`Proof text: ${ONE_FORM}.`),
    url: z.url().max(2000).optional().describe(`A bare link: ${ONE_FORM}.`),
    upload: upload.optional(),
    screen: z.string().trim().min(1).max(200).optional().describe('The mockup screen a before or after shows.'),
    width: z.number().int().min(200).max(4000).optional().describe('Width in pixels of a before or after.'),
  })
  .superRefine((value, ctx) => {
    for (const message of inputIssues(value)) ctx.addIssue({ code: 'custom', message })
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

const isUpload = (value: Input): value is UploadInput => value.upload !== undefined

const isPaired = (kind: string): boolean => kind === 'before' || kind === 'after'

const checkedScreen = async (value: UploadInput, context: AgentContext, run: Run): Promise<string | null> => {
  if (!isPaired(value.kind)) return null
  const screens = (await loadMockups(context.deps.payload, run.recordId)).map((mockup) => mockup.screen)
  if (value.screen !== undefined && screens.includes(value.screen)) return value.screen
  const known = screens.length === 0 ? 'the Brief has no mockup screens' : `use one of: ${screens.join(', ')}`
  throw new ProofRefused(`The Brief has no mockup screen "${value.screen}": ${known}.`)
}

const NO_PROOF = { criterion: null, proofSha: null, screen: null, width: null }

const fieldsOf = async (value: UploadInput, context: AgentContext, run: Run, stored: StoredRecord) => {
  if (value.kind === 'mockup') return NO_PROOF
  if (isPaired(value.kind)) {
    const screen = await checkedScreen(value, context, run)
    return { ...NO_PROOF, proofSha: value.sha ?? null, screen, width: value.width ?? null }
  }
  const proof = proofFields(value, run.recordId, stored.record.criteria)
  return { ...NO_PROOF, criterion: proof.criterion, proofSha: proof.sha }
}

const requestAddress = async (value: UploadInput, context: AgentContext, run: Run, stored: StoredRecord) => {
  const requested = await requestUpload(context.deps.payload, {
    workspace: stored.workspace,
    recordId: run.recordId,
    runId: run.id,
    stage: run.stage,
    leaseToken: value.leaseToken,
    kind: value.kind,
    caption: value.upload.caption,
    contentType: value.upload.contentType,
    ...(await fieldsOf(value, context, run, stored)),
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
    `Stores a proof for one criterion of the record of your run and returns the proof id: ${ONE_FORM}. ` +
    'With upload (a mockup, a screenshot, or a before or after of a mockup screen with screen, width and sha; ' +
    'PNG, JPEG or WebP, at most 2 MB; a mockup may also be a self-contained HTML page of at most 1 MB, ' +
    'contentType text/html) it returns { uploadUrl, expiresAt }; ' +
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
