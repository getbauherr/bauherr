import { sql } from '@payloadcms/db-postgres'
import { z } from 'zod'
import { patchRecord, readRecord } from '../../src/core/record/store'
import type { Engine } from './harness'
import { drawnPng } from './images'
import { begin, mirrorSource, workOn } from './scenario'

export const MOCKUP_TICKET_TITLE = 'Brief with a mockup'
export const MOCKUP_CAPTIONS = [
  'Export page, new: progress bar',
  'Export page, new: finished state',
  'Export page, full length',
]

type Rgb = [number, number, number]
type Block = [x: number, y: number, w: number, h: number, rgb: Rgb]

const SCREEN: Block[] = [
  [0, 0, 1280, 64, [30, 41, 59]],
  [0, 64, 240, 656, [226, 232, 240]],
  [280, 112, 960, 120, [241, 245, 249]],
  [280, 264, 960, 120, [241, 245, 249]],
  [280, 416, 640, 40, [203, 213, 225]],
  [280, 416, 440, 40, [37, 99, 235]],
]

const screen = (done: boolean): Buffer =>
  drawnPng(1280, 720, SCREEN.map(([x, y, w, h, rgb], i): Block => [x, y, w, h, done && i === 5 ? [34, 197, 94] : rgb]))

const TALL = drawnPng(1240, 2450, [
  [0, 0, 1240, 120, [30, 41, 59]],
  [0, 2330, 1240, 120, [37, 99, 235]],
])

const idOf = z.object({ id: z.coerce.number() })

type Image = { caption: string; bytes: Buffer; n: number; kind?: string; screenName?: string | null }

const store = async (e: Engine, id: number, run: number, image: Image): Promise<number> => {
  const { caption, bytes, n, kind = 'mockup', screenName = null } = image
  const stored = await e.db.payload.db.drizzle.execute(sql`
    INSERT INTO "attachments" ("workspace_id", "record_id", "run_id", "stage", "kind", "caption", "content_type",
      "byte_size", "sha256", "content", "token_hash", "lease_hash", "expires_at", "screen", "width", "proof_sha",
      "updated_at", "created_at")
    VALUES (${e.db.workspace}, ${id}, ${run}, 'brief', ${kind}, ${caption}, 'image/png', ${bytes.length},
      ${`seed${n}`}, ${bytes.toString('base64')}, ${`seed-${kind}-${id}-${n}`}, 'seed', now(),
      ${screenName}, ${screenName === null ? null : 1280},
      ${screenName === null ? null : 'seedhead'}, now(), now()) RETURNING "id"`)
  return idOf.parse(stored.rows[0]).id
}

export const SCREENSHOT_PROOF_CAPTION = 'Export page, progress bar filling'

const addScreenshotProof = async (e: Engine, id: number, run: number) => {
  const attachment = await store(e, id, run, {
    caption: SCREENSHOT_PROOF_CAPTION,
    bytes: screen(true),
    n: 20,
    kind: 'screenshot',
  })
  await e.db.payload.db.drizzle.execute(sql`
    INSERT INTO "proofs" ("workspace_id", "record_id", "criterion", "kind", "source", "sha", "attachment_id",
      "updated_at", "created_at")
    VALUES (${e.db.workspace}, ${id}, 'c1', 'screenshot', 'session', 'seedhead', ${attachment}, now(), now())`)
}

export const seedMockupTicket = async (e: Engine): Promise<number> => {
  const id = await begin(e)
  await workOn(e, id, 'builder', { verdict: 'accept' })
  const { version } = await readRecord(e.db.payload, id)
  const by = { stage: 'brief', runId: 'seed' } as const
  await patchRecord(e.db.payload, id, { expectedVersion: version, writes: ['visible'], patch: { visible: true }, by })
  await workOn(e, id, 'builder', { goal: 'Show the export progress', open: false })
  const found = await e.db.payload.db.drizzle.execute(
    sql`SELECT "id" FROM "stage_runs" WHERE "record_id" = ${id} AND "stage" = 'brief' ORDER BY "id" DESC LIMIT 1`,
  )
  const run = idOf.parse(found.rows[0]).id
  const pictures = [screen(false), screen(true), TALL]
  for (const [n, caption] of MOCKUP_CAPTIONS.entries()) await store(e, id, run, { caption, bytes: pictures[n], n })
  for (const [n, screenName] of MOCKUP_CAPTIONS.entries()) {
    const taken = { screenName, n: n * 2 + 2 }
    await store(e, id, run, { ...taken, caption: `Before: ${screenName}`, bytes: screen(false), kind: 'before' })
    const after = { ...taken, caption: `After: ${screenName}`, bytes: screen(true), kind: 'after', n: taken.n + 1 }
    await store(e, id, run, after)
  }
  await addScreenshotProof(e, id, run)
  const seeded = await readRecord(e.db.payload, id)
  const verified = { stage: 'verify', runId: 'seed' } as const
  await patchRecord(e.db.payload, id, {
    expectedVersion: seeded.version,
    writes: ['result'],
    patch: {
      result: {
        changes: [{ text: 'The export page shows its progress and a finished state.', tag: 'visible' }],
        walkthrough: ['Start an export.', 'Watch the progress bar fill.'],
        notVerified: [],
        outline: null,
        cost: { usd: 1, runs: 2, minutes: 12 },
      },
    },
    by: verified,
  })
  const { source } = (await readRecord(e.db.payload, id)).record
  await (await mirrorSource(e)).item(source.number, { title: MOCKUP_TICKET_TITLE })
  return id
}
