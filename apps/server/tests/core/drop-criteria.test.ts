import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { askOwner } from '../../src/core/ask'
import { decide, InvalidDecision, type Decision } from '../../src/core/decide'
import { advance } from '../../src/core/engine'
import { fold } from '../../src/core/lifecycle'
import { claim } from '../../src/core/run/leases'
import { readEvents, readRecord } from '../../src/core/record/store'
import { failRun } from '../../src/core/submit'
import { decisionOf, unmetAccepted } from '../../src/core/views/decision'
import { openEngine, type Engine } from './harness'

let e: Engine
beforeAll(async () => {
  e = await openEngine('core_drop_criteria')
}, 120_000)
afterAll(async () => {
  await e?.drop()
})
beforeEach(async () => {
  await e.drain()
})

const QUESTION = 'Should the email criteria stay?'
const OPTIONS = ['Keep them', 'Not sure']

const toVerify = async () => {
  const id = await e.db.fresh()
  await advance(id, e.deps())
  await e.work(id, 'builder', { verdict: 'accept' })
  await e.work(id, 'builder', { goal: 'Fix it', open: false })
  await e.work(id, 'builder', { patchId: 'p1', headSha: 'h1', pr: 1 })
  await e.checks(id)
  await e.work(id, 'reviewer', { patchId: 'p1', headSha: 'h1' })
  return id
}

const verifierAsks = async (id: number, text = QUESTION) => {
  const claimed = await claim(e.db.payload, { workspace: e.db.workspace, role: 'verifier', by: 'x', now: e.clock.now })
  if (!claimed || claimed.run.recordId !== id) throw new Error('no verifier run queued')
  await askOwner(claimed.run.id, claimed.token, { text, options: OPTIONS }, e.deps())
}

const answer = async (id: number, d: Omit<Decision, 'seq'>) =>
  decide(id, e.owner, { ...d, seq: await e.seq(id) }, e.deps())
const types = async (id: number) => (await readEvents(e.db.payload, id)).map((event) => event.type)
const queued = async (id: number) => {
  const found = await e.db.payload.db.drizzle.execute(
    sql`SELECT "stage" FROM "stage_runs" WHERE "record_id" = ${id} AND "status" = 'queued'`,
  )
  return found.rows.map((row) => row.stage)
}
const atResult = async () => {
  const id = await toVerify()
  await e.work(id, 'verifier', { passed: true, patchId: 'p1', headSha: 'h1' })
  return id
}
const cardOf = async (id: number) => (await readRecord(e.db.payload, id)).card

describe('drop criteria', () => {
  it('drops criteria on a Verify question without a new Brief, keeping the reason', async () => {
    const id = await toVerify()
    await verifierAsks(id)
    expect((await cardOf(id))?.options).toEqual([...OPTIONS, 'drop-criteria', 'accept-anyway'])
    await answer(id, { ask: 'question:agent', choice: 'drop-criteria', criteria: ['c2', 'c3'], note: 'no emails' })
    const { record } = await readRecord(e.db.payload, id)
    expect(record.criteria.map((c) => c.id)).toEqual(['c1'])
    expect(record.dropped).toEqual([
      { id: 'c2', text: 'criterion 2', note: 'no emails' },
      { id: 'c3', text: 'criterion 3', note: 'no emails' },
    ])
    const all = await types(id)
    expect(all).toContain('criteria.dropped')
    expect(all).not.toContain('brief.changes-requested')
    expect(await queued(id)).toEqual(['verify'])
  })

  it('drops criteria on the Result card and leaves the card open', async () => {
    const id = await atResult()
    const before = await cardOf(id)
    expect(before).toMatchObject({ card: 'result' })
    await answer(id, { ask: 'result', choice: 'drop-criteria', criteria: ['c3'], note: 'later' })
    expect(await cardOf(id)).toEqual(before)
    expect((await readRecord(e.db.payload, id)).record.dropped).toEqual([
      { id: 'c3', text: 'criterion 3', note: 'later' },
    ])
  })

  it('refuses unknown, repeated, empty and all criteria, and criteria on other choices', async () => {
    const id = await atResult()
    const count = (await types(id)).length
    const drop = (criteria?: string[]) =>
      answer(id, { ask: 'result', choice: 'drop-criteria', ...(criteria === undefined ? {} : { criteria }) })
    await expect(drop(['c9'])).rejects.toThrow(InvalidDecision)
    await expect(drop(['c1', 'c1'])).rejects.toThrow(InvalidDecision)
    await expect(drop([])).rejects.toThrow(InvalidDecision)
    await expect(drop()).rejects.toThrow(InvalidDecision)
    await expect(drop(['c1', 'c2', 'c3'])).rejects.toThrow(/at least one/)
    await expect(answer(id, { ask: 'result', choice: 'accept', criteria: ['c1'] })).rejects.toThrow(InvalidDecision)
    expect((await types(id)).length).toBe(count)
    expect((await readRecord(e.db.payload, id)).record.dropped).toEqual([])
  })

  it('drops criteria on the verify-rounds question and goes on with one more round', async () => {
    const id = await toVerify()
    for (const n of [1, 2]) {
      if (n > 1) {
        await e.work(id, 'builder', { patchId: `p${n}`, headSha: `h${n}`, pr: 1 })
        await e.checks(id)
        await e.work(id, 'reviewer', { patchId: `p${n}`, headSha: `h${n}` })
      }
      await e.work(id, 'verifier', { passed: false, patchId: `p${n}`, headSha: `h${n}` })
    }
    expect(await cardOf(id)).toMatchObject({ reason: 'verify-rounds' })
    await answer(id, { ask: 'question:verify-rounds', choice: 'drop-criteria', criteria: ['c1'] })
    expect((await readRecord(e.db.payload, id)).record.criteria).toHaveLength(2)
    expect(await queued(id)).toEqual(['build'])
  })
})

describe('accept anyway', () => {
  it('goes to the Result card with the unmet criteria marked accepted', async () => {
    const id = await toVerify()
    await verifierAsks(id)
    await answer(id, { ask: 'question:agent', choice: 'accept-anyway' })
    expect(await types(id)).toEqual(expect.arrayContaining(['question.answered', 'verify.overridden']))
    expect(await cardOf(id)).toMatchObject({ card: 'result' })
    const stored = await readRecord(e.db.payload, id)
    const state = fold(await readEvents(e.db.payload, id))
    expect(unmetAccepted(stored.record, state)).toEqual(['c1', 'c2', 'c3'])
  })

  it('is not offered on an agent question outside Verify', async () => {
    const id = await e.db.fresh()
    await advance(id, e.deps())
    await e.work(id, 'builder', { verdict: 'accept' })
    await e.work(id, 'builder', { goal: 'Fix it', open: false })
    const claimed = await claim(e.db.payload, { workspace: e.db.workspace, role: 'builder', by: 'x', now: e.clock.now })
    await askOwner(claimed?.run.id ?? 0, claimed?.token ?? '', { text: QUESTION, options: OPTIONS }, e.deps())
    expect((await cardOf(id))?.options).toEqual(OPTIONS)
    await expect(answer(id, { ask: 'question:agent', choice: 'accept-anyway' })).rejects.toThrow(InvalidDecision)
  })
})

describe('a repeated question', () => {
  it('lists drop-criteria and accept-anyway first', async () => {
    const id = await toVerify()
    await verifierAsks(id)
    await answer(id, { ask: 'question:agent', choice: 'Not sure' })
    await verifierAsks(id, `  ${QUESTION.toUpperCase()} `)
    expect((await cardOf(id))?.options).toEqual(['drop-criteria', 'accept-anyway', ...OPTIONS])
  })
})

describe('a failed Brief rewrite', () => {
  const toRewrite = async () => {
    const id = await e.db.fresh()
    await advance(id, e.deps())
    await e.work(id, 'builder', { verdict: 'accept' })
    await e.work(id, 'builder', { goal: 'Fix it', open: true })
    await answer(id, { ask: 'brief', choice: 'request-changes', note: 'shorter' })
    const run = await claim(e.db.payload, { workspace: e.db.workspace, role: 'builder', by: 'x', now: e.clock.now })
    await failRun(run?.run.id ?? 0, run?.token ?? '', 'the shape view is missing', e.deps())
    return id
  }

  it('shows the failure and never offers the old Brief again', async () => {
    const id = await toRewrite()
    expect(await cardOf(id)).toMatchObject({
      card: 'question',
      reason: 'brief-failed',
      options: ['retry-brief', 'discard'],
      text: 'Brief rewrite failed: the shape view is missing',
    })
    expect(await queued(id)).toEqual([])
  })

  it('queues exactly one Brief run on retry-brief', async () => {
    const id = await toRewrite()
    await answer(id, { ask: 'question:brief-failed', choice: 'retry-brief' })
    expect(await cardOf(id)).toBeNull()
    expect(await queued(id)).toEqual(['brief'])
    await e.work(id, 'builder', { goal: 'Fix it differently', open: true })
    expect(await cardOf(id)).toMatchObject({ card: 'brief' })
  })
})

describe('the decision view', () => {
  it('carries ordered options, the recommended one, active and dropped criteria', async () => {
    const id = await toVerify()
    await verifierAsks(id)
    await answer(id, { ask: 'question:agent', choice: 'Not sure' })
    await verifierAsks(id)
    const stored = await readRecord(e.db.payload, id)
    const state = fold(await readEvents(e.db.payload, id))
    const view = decisionOf(stored.card, stored.record, state)
    expect(view).toMatchObject({
      ask: 'question:agent',
      options: ['drop-criteria', 'accept-anyway', ...OPTIONS, 'own-answer', 'back-to-brief'],
      recommended: 'drop-criteria',
      criteria: [
        { id: 'c1', text: 'criterion 1' },
        { id: 'c2', text: 'criterion 2' },
        { id: 'c3', text: 'criterion 3' },
      ],
      dropped: [],
    })
  })

  it('recommends approve on a Brief and accept on a Result, and hides drop on one criterion', async () => {
    const id = await atResult()
    const stored = await readRecord(e.db.payload, id)
    const state = fold(await readEvents(e.db.payload, id))
    expect(decisionOf(stored.card, stored.record, state)).toMatchObject({
      options: ['accept', 'send-back', 'drop-criteria'],
      recommended: 'accept',
    })
    const single = { ...stored.record, criteria: stored.record.criteria.slice(0, 1) }
    expect(decisionOf(stored.card, single, state)?.options).toEqual(['accept', 'send-back'])
    expect(decisionOf(null, stored.record, state)).toBeNull()
  })
})
