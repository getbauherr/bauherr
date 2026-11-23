import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Stage } from '../../src/core/events'
import { appendEvent, createRecord } from '../../src/core/record/store'
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

const verdict = (record: number, id: number, type: 'verify.passed' | 'verify.changes') => {
  const runId = String(id)
  const actor = 'agent'
  const { payload } = e.db
  if (type === 'verify.changes') return appendEvent(payload, record, { type, actor, data: { runId, patchId: 'p' } })
  const data = { runId, patchId: 'p', headSha: 'h' }
  return appendEvent(payload, record, { type, actor, data })
}

const handed = async (statementId: number, verdicts: ('verify.passed' | 'verify.changes')[]) => {
  for (const type of verdicts) {
    const record = await ticket()
    await run(record, 'build', [statementId])
    await verdict(record, await run(record, 'verify'), type)
  }
}

describe('statementRecords', () => {
  it('counts the runs a statement reached and the next Verify of each Ticket that found problems', async () => {
    const id = await statement(await ticket(), 'Never block the queue')
    await handed(id, ['verify.changes', 'verify.changes', 'verify.passed'])
    expect(await records()).toMatchObject([{ id, handed: 3, cameBack: 2 }])
  })

  it('looks only at the next Verify after the run, and skips a Verify that gave no verdict', async () => {
    const id = await statement(await ticket(), 'Keep it small')
    const record = await ticket()
    await run(record, 'build', [id])
    await run(record, 'verify')
    const second = await run(record, 'verify')
    await verdict(record, second, 'verify.changes')
    await verdict(record, await run(record, 'verify'), 'verify.passed')
    expect(await records()).toMatchObject([{ id, handed: 1, cameBack: 1 }])
  })

  it('lists one row per run that got the statement, with the outcome of the next Verify', async () => {
    const id = await statement(await ticket(), 'Never block the queue')
    await handed(id, ['verify.changes', 'verify.passed'])
    const record = await ticket()
    await run(record, 'build', [id])
    const fares = await statementFare(e.db.payload, { workspace: e.db.workspace, id })
    expect(fares.map((fare) => [fare.stage, fare.outcome]).sort()).toEqual([
      ['build', 'came-back'],
      ['build', 'clean'],
      ['build', 'open'],
    ])
    expect(fares.find((fare) => fare.ticket.record === record)?.outcome).toBe('open')
  })
})
