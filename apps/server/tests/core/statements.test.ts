import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { decide } from '../../src/core/decide'
import { advance } from '../../src/core/engine'
import { readEvents } from '../../src/core/record/store'
import { statementOf, statementsFor, STATEMENT_MAX } from '../../src/core/statements'
import { openEngine, type Engine } from './harness'

describe('statementOf', () => {
  const given = { asked: 'result', choice: 'accept', note: '', card: null }

  it('turns a note on a send-back or a Brief change into a statement of that kind', () => {
    expect(statementOf({ ...given, choice: 'send-back', note: 'no' })).toEqual({ kind: 'send-back', text: 'no' })
    expect(statementOf({ ...given, asked: 'brief', choice: 'request-changes', note: 'shorter' })).toEqual({
      kind: 'brief-change',
      text: 'shorter',
    })
  })

  it('turns an answer into the question and the chosen option', () => {
    const card = { card: 'question' as const, reason: 'agent', options: ['a', 'b'], text: 'Which one?' }
    expect(statementOf({ asked: 'question:agent', choice: 'a', note: 'soon', card })).toEqual({
      kind: 'answer',
      text: 'Which one?: a. soon',
    })
    expect(statementOf({ asked: 'question:production', choice: 'hold', note: '', card: null })).toEqual({
      kind: 'answer',
      text: 'production: hold',
    })
  })

  it('records guidance, and nothing for a bare choice', () => {
    expect(statementOf({ asked: 'question:failed-runs', choice: 'retry-with-guidance', note: 'x', card: null }))
      .toEqual({ kind: 'guidance', text: 'x' })
    expect(statementOf({ ...given, choice: 'approve', asked: 'brief', note: 'go' })).toEqual({
      kind: 'guidance',
      text: 'go',
    })
    expect(statementOf(given)).toBeNull()
  })

  it('never exceeds the limit', () => {
    const text = statementOf({ ...given, choice: 'send-back', note: 'x'.repeat(STATEMENT_MAX + 50) })?.text
    expect(text).toHaveLength(STATEMENT_MAX)
  })
})

let e: Engine
beforeAll(async () => {
  e = await openEngine('core_statements')
}, 120_000)
afterAll(async () => {
  await e?.drop()
})
beforeEach(async () => {
  await e.drain()
  await e.db.payload.db.drizzle.execute(sql`DELETE FROM "statements"`)
})

describe('decide with statements', () => {
  it('stores the owner statement with the decision, newest first, per Product', async () => {
    const id = await e.db.fresh()
    await advance(id, e.deps())
    await e.work(id, 'builder', { verdict: 'accept' })
    await e.work(id, 'builder', { goal: 'Fix it', open: true })
    const change = { ask: 'brief', choice: 'request-changes', note: 'cut it down', seq: await e.seq(id) }
    await decide(id, e.owner, change, e.deps())
    await e.work(id, 'builder', { goal: 'Fix it', open: false })
    const stored = await statementsFor(e.db.payload, e.db.product, 5)
    expect(stored.map((s) => [s.kind, s.text, s.record])).toEqual([['brief-change', 'cut it down', id]])
    await e.drain()
    expect(await statementsFor(e.db.payload, e.db.product + 1, 5)).toEqual([])
  })

  it('stores nothing when the decision is refused', async () => {
    const id = await e.db.fresh()
    await advance(id, e.deps())
    const bad = { ask: 'brief', choice: 'request-changes', note: 'x', seq: 0 }
    await expect(decide(id, e.owner, bad, e.deps())).rejects.toThrow()
    expect(await statementsFor(e.db.payload, e.db.product, 5)).toEqual([])
  })
})

describe('a decision and its statement', () => {
  it('are written together or not at all', async () => {
    const id = await e.db.fresh()
    await advance(id, e.deps())
    await e.work(id, 'builder', { verdict: 'accept' })
    await e.work(id, 'builder', { goal: 'Fix it', open: true })
    const run = (query: ReturnType<typeof sql>) => e.db.payload.db.drizzle.execute(query)
    await run(sql`CREATE FUNCTION refuse_statement() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'statement refused'; END; $$ LANGUAGE plpgsql`)
    await run(sql`CREATE TRIGGER refuse_statement BEFORE INSERT ON "statements"
      FOR EACH ROW EXECUTE FUNCTION refuse_statement()`)
    try {
      const before = (await readEvents(e.db.payload, id)).length
      const change = { ask: 'brief', choice: 'request-changes', note: 'cut it down', seq: await e.seq(id) }
      await expect(decide(id, e.owner, change, e.deps())).rejects.toThrow()
      expect((await readEvents(e.db.payload, id)).length).toBe(before)
      expect(await statementsFor(e.db.payload, e.db.product, 5)).toEqual([])
    } finally {
      await run(sql`DROP TRIGGER refuse_statement ON "statements"`)
      await run(sql`DROP FUNCTION refuse_statement()`)
    }
  })
})
