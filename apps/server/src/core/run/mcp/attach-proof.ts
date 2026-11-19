import { sql } from '@payloadcms/db-postgres'
import { z } from 'zod'
import { readRecord } from '../../record/store'
import { ProofRefused } from '../errors'
import { authorize } from '../leases'
import { defineTool, leaseToken, ownRun, runId } from './tool'

export const PROOF_KINDS = ['screenshot', 'recording', 'output', 'link'] as const
export const BODY_MAX = 20_000

const input = z
  .strictObject({
    runId,
    leaseToken,
    criterion: z.string().trim().min(1),
    kind: z.enum(PROOF_KINDS),
    sha: z.string().trim().min(1).max(100),
    body: z.string().min(1).max(BODY_MAX).optional(),
    url: z.url().max(2000).optional(),
  })
  .refine((value) => (value.body === undefined) !== (value.url === undefined), {
    message: 'give exactly one of body and url',
  })

export const attachProof = defineTool({
  name: 'attach_proof',
  description: 'Stores a proof for one criterion of the record of your run, as text or a URL. Returns the proof id.',
  access: 'agent',
  input,
  run: async (value, context) => {
    const { payload } = context.deps
    await ownRun(context, value.runId)
    const run = await authorize(payload, value.runId, value.leaseToken)
    const stored = await readRecord(payload, run.recordId)
    if (!stored.record.criteria.some((criterion) => criterion.id === value.criterion)) {
      throw new ProofRefused(`Record ${run.recordId} has no criterion ${value.criterion}: use an id from the record.`)
    }
    const inserted = await payload.db.drizzle.execute(sql`
      INSERT INTO "proofs" ("workspace_id", "record_id", "criterion", "kind", "source", "sha", "body", "url",
        "updated_at", "created_at")
      VALUES (${stored.workspace}, ${run.recordId}, ${value.criterion}, ${value.kind}, 'session', ${value.sha},
        ${value.body ?? null}, ${value.url ?? null}, now(), now())
      RETURNING "id"`)
    return { proofId: z.coerce.number().parse(inserted.rows[0]?.id) }
  },
})
