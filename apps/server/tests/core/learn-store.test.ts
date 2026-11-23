import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { decide } from '../../src/core/decide'
import { advance } from '../../src/core/engine'
import { addMemory } from '../../src/core/memory-store'
import { patchRecord, readEvents, readRecord } from '../../src/core/record/store'
import { claim } from '../../src/core/run/leases'
import { contextPack } from '../../src/core/run/pack'
import { failRun, submit } from '../../src/core/submit'
import { board } from '../../src/core/views/board'
import { holds } from '../../src/core/views/holds'
import { statementRecords } from '../../src/core/views/statement-records'
import { ticket } from '../../src/core/views/ticket'
import { learn } from '../../src/modules/learn/module'
import { openEngine, TEST_MODULES, type Engine } from './harness'

let e: Engine
const modules = { ...TEST_MODULES, learn }

beforeAll(async () => {
  e = await openEngine('core_learn_store', modules)
  await e.db.payload.update({
    collection: 'products',
    id: e.db.product,
    data: { riskAreas: ['adapters'] },
    overrideAccess: true,
  })
}, 120_000)
afterAll(async () => {
  await e?.drop()
})
beforeEach(async () => {
  e.config = { ...e.config, caps: { verifyRounds: 3, reporterRounds: 2, failedRuns: 2 }, productionGate: false }
  e.merges.length = 0
  await e.drain()
  await e.db.payload.db.drizzle.execute(sql`DELETE FROM "statements"`)
})

const FINDING = {
  id: 'f1',
  axis: 'spec' as const,
  text: 'The list drops the last row',
  evidence: { kind: 'repro' as const, pointer: 'open the list with three rows' },
  status: 'fixed' as const,
}
const NEW = { from: 'f1', text: 'Check the last row of every list.', applies: 'fit' }
const EMPTY = { lessons: [], cameBack: [] }

const accepted = async (findings = true) => {
  const id = await e.db.fresh()
  await advance(id, e.deps())
  await e.work(id, 'builder', { verdict: 'accept' })
  await e.work(id, 'builder', { goal: 'Fix it', open: false })
  await e.work(id, 'builder', { patchId: 'p1', headSha: 'h1', pr: 1 })
  await e.checks(id)
  await e.work(id, 'verifier', { passed: true, patchId: 'p1', headSha: 'h1' })
  if (findings) {
    const stored = await readRecord(e.db.payload, id)
    await patchRecord(e.db.payload, id, {
      expectedVersion: stored.version,
      writes: ['findings'],
      patch: { findings: [FINDING] },
      by: { stage: 'verify', runId: 'x' },
    })
  }
  await decide(id, e.owner, { ask: 'result', choice: 'accept', seq: await e.seq(id) }, e.deps())
  return id
}

const queued = async (id: number) =>
  (
    await e.db.payload.db.drizzle.execute(
      sql`SELECT "stage", "role" FROM "stage_runs" WHERE "record_id" = ${id} AND "status" = 'queued'`,
    )
  ).rows
const types = async (id: number) => (await readEvents(e.db.payload, id)).map((event) => event.type)
const submittedOf = async (id: number) =>
  (await readEvents(e.db.payload, id)).findLast((event) => event.type === 'learn.submitted')?.data
const memories = () => statementRecords(e.db.payload, { workspace: e.db.workspace, product: e.db.product })
const learnWith = (id: number, result: unknown) => e.work(id, 'reviewer', result)
const claimLearn = async () => {
  const claimed = await claim(e.db.payload, { workspace: e.db.workspace, role: 'reviewer', by: 'x', now: e.clock.now })
  if (!claimed) throw new Error('no Learn run is queued')
  return claimed
}
const addOwn = (text: string, product = e.db.product) => {
  const who = { person: e.owner, workspace: e.db.workspace }
  return addMemory(e.db.payload, who, { product, input: { text, reach: 'fit', stages: ['build'] } })
}

describe('the Learn run of an accepted ticket', () => {
  it('is queued for a corrected ticket, which is done and accepted in every view meanwhile', async () => {
    const id = await accepted()
    expect(await queued(id)).toEqual([{ stage: 'done', role: 'reviewer' }])
    expect(await e.view(id)).toMatchObject({ stage: 'done', waitingOn: 'nobody' })
    expect(await ticket(e.db.payload, { workspace: e.db.workspace, recordId: id })).toMatchObject({
      stage: 'done',
      ended: 'accepted',
      status: 'accepted',
    })
    const lanes = await board(e.db.payload, { workspace: e.db.workspace, now: e.clock.now })
    expect(lanes.stages.done.map((card) => card.recordId)).toContain(id)
  })

  it('counts as a run that waits for a reviewer session', async () => {
    await accepted()
    const hold = (await holds(e.db.payload, { workspace: e.db.workspace, now: e.clock.now })).find(
      (entry) => entry.kind === 'no-agent-connected' && entry.role === 'reviewer',
    )
    expect(hold).toMatchObject({ queued: 1, byStage: [{ stage: 'done', queued: 1 }] })
  })

  it('is not queued for a ticket nothing corrected', async () => {
    const id = await accepted(false)
    expect(await queued(id)).toEqual([])
  })

  it('hands the run the corrections, the memories its ticket runs got and similar memories', async () => {
    const handed = await addOwn('Lists keep their last row.')
    await accepted()
    const claimed = await claimLearn()
    const pack = await contextPack(e.deps(), claimed.run)
    expect(pack).toMatchObject({ stage: 'done', role: 'reviewer', learn: { corrections: [], handed: [] } })
    expect(pack.learn?.candidates).toEqual([{ id: handed, text: 'Lists keep their last row.' }])
    expect(pack.statements).toEqual([])
  })

  it('stores a new memory with its source, the Learn run and not seen yet, and ends the run', async () => {
    const id = await accepted()
    expect(await learnWith(id, { lessons: [NEW], cameBack: [] })).toEqual({ status: 'accepted' })
    const [memory] = await memories()
    expect(memory).toMatchObject({
      kind: 'learned',
      scope: 'product',
      applies: 'fit',
      text: NEW.text,
      isNew: true,
      cameBack: 0,
      from: 'Reviewer finding',
      sourceText: `${FINDING.text} Evidence: ${FINDING.evidence.pointer}`,
      ticket: { record: id },
    })
    expect(memory?.learnRun).toBeGreaterThan(0)
    expect(memory?.stages).toEqual(['brief', 'build', 'review', 'verify'])
    expect(await queued(id)).toEqual([])
    expect(await submittedOf(id)).toMatchObject({ memories: 1, cameBack: 0 })
    expect(await e.view(id)).toMatchObject({ stage: 'done', waitingOn: 'nobody' })
  })

  it('accepts an empty answer and keeps nothing', async () => {
    const id = await accepted()
    expect(await learnWith(id, EMPTY)).toEqual({ status: 'accepted' })
    expect(await memories()).toEqual([])
    expect(await types(id)).toContain('learn.submitted')
  })

  it('stores a repeated memory and every cameBack id as one mark per memory and ticket', async () => {
    const existing = await addOwn('Lists keep their last row.')
    const first = await accepted()
    await learnWith(first, { lessons: [{ from: 'f1', repeats: existing }], cameBack: [existing] })
    expect(await memories()).toMatchObject([{ id: existing, cameBack: 1 }])
    expect(await submittedOf(first)).toMatchObject({ memories: 0, cameBack: 1 })
    const second = await accepted()
    await learnWith(second, { lessons: [], cameBack: [existing] })
    expect(await memories()).toMatchObject([{ id: existing, cameBack: 2 }])
  })

  it('refuses always, an unknown area, an unknown id or source and more than 5 lessons', async () => {
    await accepted()
    const bad = [
      { lessons: [{ ...NEW, applies: 'always' }], cameBack: [] },
      { lessons: [{ ...NEW, applies: 'area', area: 'billing' }], cameBack: [] },
      { lessons: [{ ...NEW, applies: 'area' }], cameBack: [] },
      { lessons: [{ from: 'f1', repeats: 999999 }], cameBack: [] },
      { lessons: [], cameBack: [999999] },
      { lessons: [{ ...NEW, from: 'f9' }], cameBack: [] },
      { lessons: [{ ...NEW, from: 'n1' }], cameBack: [] },
      { lessons: [{ ...NEW, text: 'x'.repeat(301) }], cameBack: [] },
      { lessons: Array.from({ length: 6 }, () => NEW), cameBack: [] },
    ]
    for (const result of bad) {
      const claimed = await claimLearn()
      expect(await submit(claimed.run.id, claimed.token, result, e.deps())).toMatchObject({ status: 'retry' })
      await e.db.payload.db.drizzle.execute(
        sql`UPDATE "stage_runs" SET "status" = 'queued', "attempt" = 0 WHERE "id" = ${claimed.run.id}`,
      )
    }
    expect(await memories()).toEqual([])
  })

  it('refuses a memory of another Product with the one fix turn message', async () => {
    const other = z.coerce.number().parse(
      (await e.db.payload.create({
        collection: 'products',
        data: { name: 'q', slug: 'q', workspace: e.db.workspace },
        overrideAccess: true,
      })).id,
    )
    const foreign = await addOwn('Another Product rule.', other)
    await accepted()
    const claimed = await claimLearn()
    const refused = await submit(claimed.run.id, claimed.token, { lessons: [], cameBack: [foreign] }, e.deps())
    expect(refused).toMatchObject({ status: 'retry', problems: [{ path: 'cameBack' }] })
  })

  it('is given up with learn.skipped after two failed runs, without a question card', async () => {
    const id = await accepted()
    for (let i = 0; i < 2; i++) {
      const claimed = await claimLearn()
      await failRun(claimed.run.id, claimed.token, 'no result', e.deps())
    }
    expect(await types(id)).toContain('learn.skipped')
    expect(await types(id)).not.toContain('question.asked')
    expect(await queued(id)).toEqual([])
    expect(await e.view(id)).toMatchObject({ stage: 'done', waitingOn: 'nobody', card: null })
  })
})
