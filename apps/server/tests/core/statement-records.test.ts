import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Stage } from '../../src/core/events'
import { appendEvent, createRecord } from '../../src/core/record/store'
import { enqueue } from '../../src/core/run/leases'
import { rememberContext } from '../../src/core/run/context'
import { storeStatement } from '../../src/core/statements'
import { markMemorySeen } from '../../src/core/memory-store'
import {
  keptMemories,
  newMemoryCount,
  statementFare,
  statementRecords,
} from '../../src/core/views/statement-records'
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

const mark = (statementId: number, record: number) =>
  e.db.payload.db.drizzle.execute(
    sql`UPDATE "statements" SET "came_back" = "came_back" || ${JSON.stringify([{ record, run: 1 }])}::jsonb
      WHERE "id" = ${statementId}`,
  )

const accept = (record: number) =>
  appendEvent(e.db.payload, record, { type: 'result.accepted', data: {}, actor: 'owner' })

const learned = async (record: number, over: { kind?: string; seen?: boolean } = {}) => {
  const found = await e.db.payload.db.drizzle.execute(sql`
    INSERT INTO "statements" ("workspace_id", "product_id", "record_id", "kind", "scope", "text", "source_kind",
      "source_text", "learn_run", "seen_at", "updated_at", "created_at")
    SELECT "workspace_id", "product_id", "id", 'learned', 'product', 'Check the last row.', ${over.kind ?? 'finding'},
      'The list drops the last row', 42, ${over.seen ? new Date().toISOString() : null}::timestamptz, now(), now()
    FROM "records" WHERE "id" = ${record} RETURNING "id"`)
  return Number(found.rows[0]?.id)
}

describe('statementRecords', () => {
  it('counts the runs a statement reached and the tickets with a came-back mark', async () => {
    const id = await statement(await ticket(), 'Never block the queue')
    const first = await ticket()
    const second = await ticket()
    for (const record of [first, second, await ticket()]) await run(record, 'build', [id])
    await mark(id, first)
    await mark(id, second)
    expect(await records()).toMatchObject([{ id, handed: 3, cameBack: 2 }])
  })

  it('does not count a Verify that asked for changes as coming back', async () => {
    const id = await statement(await ticket(), 'Keep it small')
    const record = await ticket()
    await run(record, 'build', [id])
    await appendEvent(e.db.payload, record, {
      type: 'verify.changes',
      data: { runId: '1', patchId: 'p' },
      actor: 'agent',
    })
    expect(await records()).toMatchObject([{ id, handed: 1, cameBack: 0 }])
  })

  it('lists one row per run that got the statement: Came back by a mark, Clean when accepted, else open', async () => {
    const id = await statement(await ticket(), 'Never block the queue')
    const back = await ticket()
    const clean = await ticket()
    const open = await ticket()
    for (const record of [back, clean, open]) await run(record, 'build', [id])
    await mark(id, back)
    await accept(back)
    await accept(clean)
    const fares = await statementFare(e.db.payload, { workspace: e.db.workspace, id })
    const outcome = (record: number) => fares.find((fare) => fare.ticket.record === record)?.outcome
    expect([outcome(back), outcome(clean), outcome(open)]).toEqual(['came-back', 'clean', 'open'])
  })

  it('shows an accepted ticket as open while its Learn run is queued', async () => {
    const id = await statement(await ticket(), 'Never block the queue')
    const record = await ticket()
    await run(record, 'build', [id])
    await accept(record)
    await enqueue(e.db.payload, record, { stage: 'done', role: 'reviewer', fingerprint: 'learn' })
    const fares = await statementFare(e.db.payload, { workspace: e.db.workspace, id })
    expect(fares[0]?.outcome).toBe('open')
  })
})

describe('learned memories', () => {
  it('is New until it is opened, says where it came from and names the Learn run', async () => {
    const record = await ticket()
    const id = await learned(record)
    const [row] = await records()
    expect(row).toMatchObject({
      id,
      kind: 'learned',
      isNew: true,
      from: 'Reviewer finding',
      sourceText: 'The list drops the last row',
      learnRun: 42,
    })
    expect(await newMemoryCount(e.db.payload, e.db.workspace)).toBe(1)
    await markMemorySeen(e.db.payload, { workspace: e.db.workspace, id })
    expect(await records()).toMatchObject([{ id, isNew: false }])
    expect(await newMemoryCount(e.db.payload, e.db.workspace)).toBe(0)
  })

  it('words the origin of a send-back and a Brief change, and never marks written memories New', async () => {
    await learned(await ticket(), { kind: 'send-back' })
    await learned(await ticket(), { kind: 'brief-change' })
    await statement(await ticket(), 'Written by the owner')
    const rows = await records()
    expect(rows.map((row) => [row.from, row.isNew]).sort()).toEqual([
      ['Your Brief change', true],
      ['Your guidance', false],
      ['Your send-back', true],
    ])
  })

  it('lists the memories a ticket got from Learn', async () => {
    const record = await ticket()
    const id = await learned(record)
    expect(await keptMemories(e.db.payload, record)).toEqual([{ id, text: 'Check the last row.' }])
    expect(await keptMemories(e.db.payload, await ticket())).toEqual([])
  })
})
