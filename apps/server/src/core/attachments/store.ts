import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { inLockedRecord, type Conn } from '../conn'
import { hashOf } from '../run/leases'
import {
  imageTypeOf,
  RECORD_IMAGE_MAX,
  RUN_IMAGE_MAX,
  UPLOAD_TTL_MS,
  UploadRefused,
  type AttachmentKind,
  type ImageType,
} from './image'

export type UploadRequest = {
  workspace: number
  recordId: number
  runId: number
  stage: string
  leaseToken: string
  kind: AttachmentKind
  caption: string
  contentType: ImageType
  criterion: string | null
  proofSha: string | null
  now: Date
}

export type Received = { attachmentId: number; proofId: number | null }

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')

const sameHash = (a: string, b: string): boolean =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

const countOf = z.object({ run_images: z.coerce.number(), record_images: z.coerce.number() })

const imagesOf = async (db: Conn, runId: number, recordId: number, pendingUntil: Date | null) => {
  const counted = pendingUntil === null ? sql`false` : sql`"expires_at" > ${pendingUntil.toISOString()}`
  const found = await db.db.drizzle.execute(sql`
    SELECT count(*) FILTER (WHERE "run_id" = ${runId}) AS run_images, count(*) AS record_images
    FROM "attachments"
    WHERE "record_id" = ${recordId}
      AND ("content" IS NOT NULL OR ${counted})`)
  return countOf.parse(found.rows[0])
}

const refuseOverLimit = (counts: z.infer<typeof countOf>): void => {
  if (counts.run_images >= RUN_IMAGE_MAX) {
    throw new UploadRefused(`This run already has ${RUN_IMAGE_MAX} images: attach no more.`, 409)
  }
  if (counts.record_images >= RECORD_IMAGE_MAX) {
    throw new UploadRefused(`This record already has ${RECORD_IMAGE_MAX} images: attach no more.`, 409)
  }
}

export const requestUpload = async (
  payload: Payload,
  input: UploadRequest,
): Promise<{ token: string; expiresAt: string }> => {
  const db: Conn = payload
  refuseOverLimit(await imagesOf(db, input.runId, input.recordId, input.now))
  await db.db.drizzle.execute(
    sql`DELETE FROM "attachments" WHERE "run_id" = ${input.runId} AND "content" IS NULL
      AND "expires_at" <= ${input.now.toISOString()}`,
  )
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(input.now.getTime() + UPLOAD_TTL_MS).toISOString()
  await db.db.drizzle.execute(sql`
    INSERT INTO "attachments" ("workspace_id", "record_id", "run_id", "stage", "kind", "caption", "content_type",
      "token_hash", "lease_hash", "expires_at", "criterion", "proof_sha", "updated_at", "created_at")
    VALUES (${input.workspace}, ${input.recordId}, ${input.runId}, ${input.stage}, ${input.kind}, ${input.caption},
      ${input.contentType}, ${hashToken(token)}, ${hashOf(input.leaseToken)}, ${expiresAt}, ${input.criterion},
      ${input.proofSha}, now(), now())`)
  return { token, expiresAt }
}

const pendingRow = z.object({
  id: z.coerce.number(),
  workspace_id: z.coerce.number(),
  record_id: z.coerce.number(),
  run_id: z.coerce.number(),
  kind: z.string(),
  content_type: z.string(),
  criterion: z.string().nullable(),
  proof_sha: z.string().nullable(),
  lease_hash: z.string(),
  expires_at: z.coerce.date(),
  used: z.boolean(),
  run_status: z.string(),
  run_lease_hash: z.string().nullable(),
})
type Pending = z.infer<typeof pendingRow>

const TOKEN_FORM = /^[0-9a-f]{64}$/

const pendingOf = async (db: Conn, token: string, now: Date, lock: boolean): Promise<Pending> => {
  if (!TOKEN_FORM.test(token)) throw new UploadRefused('Unknown upload address.', 404)
  const found = await db.db.drizzle.execute(sql`
    SELECT a."id", a."workspace_id", a."record_id", a."run_id", a."kind", a."content_type", a."criterion",
      a."proof_sha", a."lease_hash", a."expires_at", a."content" IS NOT NULL AS used,
      s."status" AS run_status, s."lease_token_hash" AS run_lease_hash
    FROM "attachments" a JOIN "stage_runs" s ON s."id" = a."run_id"
    WHERE a."token_hash" = ${hashToken(token)} ${lock ? sql`FOR UPDATE OF a` : sql``}`)
  if (!found.rows[0]) throw new UploadRefused('Unknown upload address.', 404)
  const row = pendingRow.parse(found.rows[0])
  if (row.used) throw new UploadRefused('This upload address was already used: ask for a new one.', 409)
  if (row.expires_at <= now) throw new UploadRefused('This upload address expired: ask for a new one.', 410)
  const bound = row.run_status === 'claimed' && sameHash(row.run_lease_hash ?? '', row.lease_hash)
  if (!bound) throw new UploadRefused('The run no longer holds its lease: stop working on it.', 409)
  return row
}

export const checkUpload = async (payload: Payload, token: string, now: Date): Promise<void> => {
  await pendingOf(payload, token, now, false)
}

const store = async (tx: Conn, pending: Pending, bytes: Uint8Array, type: ImageType): Promise<number | null> => {
  const sha = createHash('sha256').update(bytes).digest('hex')
  await tx.db.drizzle.execute(sql`
    UPDATE "attachments" SET "content_type" = ${type}, "byte_size" = ${bytes.length}, "sha256" = ${sha},
      "content" = ${Buffer.from(bytes).toString('base64')}, "updated_at" = now() WHERE "id" = ${pending.id}`)
  if (pending.kind !== 'screenshot') return null
  const proof = await tx.db.drizzle.execute(sql`
    INSERT INTO "proofs" ("workspace_id", "record_id", "criterion", "kind", "source", "sha", "attachment_id",
      "updated_at", "created_at")
    VALUES (${pending.workspace_id}, ${pending.record_id}, ${pending.criterion}, 'screenshot', 'session',
      ${pending.proof_sha}, ${pending.id}, now(), now())
    RETURNING "id"`)
  return z.coerce.number().parse(proof.rows[0]?.id)
}

export const receiveUpload = async (
  payload: Payload,
  token: string,
  bytes: Uint8Array,
  now: Date,
): Promise<Received> => {
  const type = imageTypeOf(bytes)
  if (type === null) throw new UploadRefused('The file is not a PNG, JPEG or WebP image.', 415)
  const first = await pendingOf(payload, token, now, false)
  return inLockedRecord(payload, first.record_id, async (tx) => {
    const pending = await pendingOf(tx, token, now, true)
    if (pending.content_type !== type) {
      throw new UploadRefused(`The file is ${type}, but the upload was announced as ${pending.content_type}.`, 415)
    }
    refuseOverLimit(await imagesOf(tx, pending.run_id, pending.record_id, null))
    return { attachmentId: pending.id, proofId: await store(tx, pending, bytes, type) }
  })
}
