import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { runPage } from '../../src/core/views/run'
import { ticket } from '../../src/core/views/ticket'
import { openViews, seed, type Seeded } from './views-harness'

let s: Seeded
const run = (query: ReturnType<typeof sql>) => s.e.db.payload.db.drizzle.execute(query)
const view = (recordId: number) => ticket(s.e.db.payload, { workspace: s.e.db.workspace, recordId })

beforeAll(async () => {
  s = await seed(await openViews('core_views_attachments'))
}, 240_000)
afterAll(async () => {
  await s?.e.drop()
})

it('carries the mockups of the latest submitted Brief run only, and a screenshot proof with its image', async () => {
  const id = s.names.verifying
  const image = (runId: number, kind: string, caption: string) =>
    run(sql`INSERT INTO "attachments" ("workspace_id", "record_id", "run_id", "stage", "kind", "caption",
      "content_type", "byte_size", "content", "token_hash", "lease_hash", "expires_at", "updated_at", "created_at")
      VALUES (${s.e.db.workspace}, ${id}, ${runId}, 'brief', ${kind}, ${caption}, 'image/png', 2048, 'AA',
      ${`${caption}-${runId}`}, 'l', now(), now(), now()) RETURNING "id"`)
  const first = await run(sql`SELECT "id" FROM "stage_runs" WHERE "record_id" = ${id} AND "stage" = 'brief'`)
  const oldRun = Number(first.rows[0]?.id)
  await image(oldRun, 'mockup', 'Old list')
  const again = await run(sql`INSERT INTO "stage_runs" ("workspace_id", "record_id", "stage", "role", "status",
    "fingerprint", "attempt", "steps", "updated_at", "created_at")
    SELECT "workspace_id", "record_id", 'brief', "role", 'submitted', 'again', 0, '[]'::jsonb, now(), now()
    FROM "stage_runs" WHERE "id" = ${oldRun} RETURNING "id"`)
  const newRun = Number(again.rows[0]?.id)
  await image(newRun, 'mockup', 'New list')
  const shot = await image(newRun, 'screenshot', 'Shot of the list')
  const shotId = Number(shot.rows[0]?.id)
  await run(sql`INSERT INTO "proofs" ("workspace_id", "record_id", "criterion", "kind", "source", "sha",
    "attachment_id", "updated_at", "created_at") VALUES (${s.e.db.workspace}, ${id}, 'c3', 'screenshot', 'session',
    'h1', ${shotId}, now(), now())`)
  const t = await view(id)
  expect(t.noMockup).toBe(false)
  expect(t.mockups).toMatchObject([{ caption: 'New list', bytes: 2048 }])
  const proof = t.proofs.find((group) => group.criterion === 'c3')?.proofs[0]
  expect(proof).toMatchObject({ body: null, url: null, attachment: { id: shotId, caption: 'Shot of the list' } })
  const page = await runPage(s.e.db.payload, { workspace: s.e.db.workspace, runId: newRun, withCost: false })
  expect(page.attachments.map((a) => a.caption)).toEqual(['New list', 'Shot of the list'])
})


it('flags a visible Brief without a mockup for the card', async () => {
  const id = s.names.resultCard
  expect((await view(id)).noMockup).toBe(false)
  await run(sql`UPDATE "records" SET "data" = jsonb_set("data", '{visible}', 'true') WHERE "id" = ${id}`)
  expect((await view(id)).noMockup).toBe(true)
})
