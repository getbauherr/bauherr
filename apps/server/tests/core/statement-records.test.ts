import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Stage } from '../../src/core/events'
import { appendEvent, createRecord } from '../../src/core/record/store'
import { enqueue } from '../../src/core/run/leases'
import { rememberContext } from '../../src/core/run/context'
import { storeStatement } from '../../src/core/statements'
import { statementRecords } from '../../src/core/views/statement-records'
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
  await storeStatement(e.db.payload, record, { kind: 'guidance', text })
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
    expect(await records()).toMatchObject([{ id, handed: 3, cameBack: 2, makeCheck: false, unused: false }])
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

  it('flags make this a check at three comebacks, not at two', async () => {
    const two = await statement(await ticket(), 'Two')
    const three = await statement(await ticket(), 'Three')
    await handed(two, ['verify.changes', 'verify.changes'])
    await handed(three, ['verify.changes', 'verify.changes', 'verify.changes'])
    const found = await records()
    expect(found.find((r) => r.id === two)?.makeCheck).toBe(false)
    expect(found.find((r) => r.id === three)?.makeCheck).toBe(true)
  })

  it('lists a statement as unused after 60 days without a run, and not when a run reached it since', async () => {
    const old = await statement(await ticket(), 'Old and unused')
    const used = await statement(await ticket(), 'Old but used')
    const fresh = await statement(await ticket(), 'Fresh')
    await run(await ticket(), 'build', [used])
    await e.db.payload.db.drizzle.execute(
      sql`UPDATE "statements" SET "created_at" = now() - interval '61 days' WHERE "id" IN (${old}, ${used})`,
    )
    const found = await records()
    expect(found.filter((r) => r.unused).map((r) => r.id)).toEqual([old])
    expect(found.find((r) => r.id === fresh)?.unused).toBe(false)
    const later = await statementRecords(e.db.payload, scope(), new Date(Date.now() + 61 * 86_400_000))
    expect(later.filter((r) => r.unused)).toHaveLength(3)
  })
})
