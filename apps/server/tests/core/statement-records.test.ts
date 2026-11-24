import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Stage } from '../../src/core/events'
import { createRecord } from '../../src/core/record/store'
import { enqueue } from '../../src/core/run/leases'
import { rememberContext } from '../../src/core/run/context'
import { storeStatement } from '../../src/core/statements'
import { statementFare, statementRecords } from '../../src/core/views/statement-records'
import { source } from './fixtures'
import { openEngine, type Engine } from './harness'

let e: Engine
let next = 5000

beforeAll(async () => {
  e = await openEngine('core_statement_records')
}, 120_000)
afterAll(async () => {
  await e?.drop()
})
beforeEach(async () => {
  await e.drain()
  await e.db.payload.db.drizzle.execute(sql`DELETE FROM "statements"`)
})

const scope = () => ({ workspace: e.db.workspace, product: e.db.product })
const records = () => statementRecords(e.db.payload, scope())

const ticket = async () =>
  (await createRecord(e.db.payload, { ...scope(), source: { ...source, number: next++ }, type: 'bug' })).id

const statement = async (record: number, text: string) => {
  await storeStatement(e.db.payload, record, { kind: 'guidance', scope: 'ticket', text })
  const found = await e.db.payload.db.drizzle.execute(
    sql`SELECT max("id") AS id FROM "statements" WHERE "record_id" = ${record}`,
  )
  return Number(found.rows[0]?.id)
}

const run = async (record: number, stage: Stage, statements: number[] = []) => {
  const role = stage === 'verify' ? 'verifier' : 'builder'
  const { run } = await enqueue(e.db.payload, record, { stage, role, fingerprint: `fp-${next++}` })
  await e.db.payload.db.drizzle.execute(sql`UPDATE "stage_runs" SET "status" = 'released' WHERE "id" = ${run.id}`)
  await rememberContext(e.db.payload, run.id, { statements, similar: [], agentsFile: { given: false, cut: false } })
  return run.id
}

const learned = async (record: number, kind = 'finding') => {
  const found = await e.db.payload.db.drizzle.execute(sql`
    INSERT INTO "statements" ("workspace_id", "product_id", "record_id", "kind", "scope", "text", "source_kind",
      "source_text", "updated_at", "created_at")
    SELECT "workspace_id", "product_id", "id", 'learned', 'product', 'Check the last row.', ${kind},
      'The list drops the last row', now(), now()
    FROM "records" WHERE "id" = ${record} RETURNING "id"`)
  return Number(found.rows[0]?.id)
}

describe('statementRecords', () => {
  it('counts the runs a statement reached', async () => {
    const id = await statement(await ticket(), 'Never block the queue')
    for (const record of [await ticket(), await ticket(), await ticket()]) await run(record, 'build', [id])
    expect(await records()).toMatchObject([{ id, handed: 3 }])
  })

  it('lists one row per run that got the statement', async () => {
    const id = await statement(await ticket(), 'Never block the queue')
    const first = await ticket()
    const second = await ticket()
    for (const record of [first, second]) await run(record, 'build', [id])
    const fares = await statementFare(e.db.payload, { workspace: e.db.workspace, id })
    expect(fares.map((fare) => fare.ticket.record).sort()).toEqual([first, second].sort())
  })
})

describe('learned memories', () => {
  it('still shows its text, where it came from and the quote it came from', async () => {
    const id = await learned(await ticket())
    const [row] = await records()
    expect(row).toMatchObject({
      id,
      kind: 'learned',
      text: 'Check the last row.',
      from: 'Reviewer finding',
      sourceText: 'The list drops the last row',
    })
  })

  it('words the origin of a send-back and a Brief change', async () => {
    await learned(await ticket(), 'send-back')
    await learned(await ticket(), 'brief-change')
    await statement(await ticket(), 'Written by the owner')
    expect((await records()).map((row) => row.from).sort()).toEqual([
      'Your Brief change',
      'Your guidance',
      'Your send-back',
    ])
  })
})
