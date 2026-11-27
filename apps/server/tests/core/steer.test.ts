import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { askOwner } from '../../src/core/ask'
import { decide } from '../../src/core/decide'
import { advance } from '../../src/core/engine'
import { listMessages } from '../../src/core/conversations/store'
import { readEvents, readRecord } from '../../src/core/record/store'
import { claim } from '../../src/core/run/leases'
import { systemOf } from '../../src/core/steer/context'
import { findSteerConversation } from '../../src/core/steer/store'
import { FALLBACK_NOTE, steerTurn, type SteerDeps } from '../../src/core/steer/turn'
import { ticket } from '../../src/core/views/ticket'
import { openEngine, type Engine } from './harness'

let e: Engine
beforeAll(async () => {
  e = await openEngine('core_steer')
}, 120_000)
afterAll(async () => {
  await e?.drop()
})
beforeEach(async () => {
  await e.drain()
})

const toVerifyQuestion = async () => {
  const id = await e.db.fresh()
  await advance(id, e.deps())
  await e.work(id, 'builder', { verdict: 'accept' })
  await e.work(id, 'builder', { goal: 'Fix it', open: false })
  await e.work(id, 'builder', { patchId: 'p1', headSha: 'h1', pr: 1 })
  await e.checks(id)
  await e.work(id, 'reviewer', { patchId: 'p1', headSha: 'h1' })
  const who = { workspace: e.db.workspace, role: 'verifier' as const, by: 'x', now: e.clock.now }
  const claimed = await claim(e.db.payload, who)
  if (!claimed) throw new Error('no verifier run queued')
  const ask = { text: 'Keep the emails?', options: ['Keep them', 'Not sure'] }
  await askOwner(claimed.run.id, claimed.token, ask, e.deps())
  return id
}

type Calls = { turns: number; comments: string[]; prompts: { system: string; turns: number }[] }
const dependsOn = (replies: (string | Error)[]): { deps: SteerDeps; calls: Calls } => {
  const calls: Calls = { turns: 0, comments: [], prompts: [] }
  const deps: SteerDeps = {
    model: (_workspace, system, turns) => {
      const next = replies[Math.min(calls.turns, replies.length - 1)]
      calls.turns += 1
      calls.prompts.push({ system, turns: turns.length })
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next ?? '')
    },
    comment: (text) => {
      calls.comments.push(text)
      return Promise.resolve(null)
    },
  }
  return { deps, calls }
}

const say = (id: number, text: string, deps: SteerDeps) =>
  steerTurn(e.db.payload, deps, { workspace: e.db.workspace, recordId: id, text })
const reply = (body: object) => JSON.stringify(body)
const eventCount = async (id: number) => (await readEvents(e.db.payload, id)).length
const texts = async (id: number) => {
  const conversation = await findSteerConversation(e.db.payload, e.db.workspace, id)
  return conversation === null ? [] : (await listMessages(e.db.payload, conversation)).map((m) => [m.role, m.text])
}

describe('steering a ticket from the composer', () => {
  it('turns a drop request into an intent with the option and criteria and writes nothing', async () => {
    const id = await toVerifyQuestion()
    const before = await eventCount(id)
    const drop = { say: 'c2 and c3 are the email ones.', tool: 'drop-criteria', criteria: ['c2', 'c3'] }
    const { deps } = dependsOn([reply(drop)])
    const outcome = await say(id, 'drop the email criteria', deps)
    expect(outcome.kind).toBe('decide')
    if (outcome.kind !== 'decide') return
    const wanted = { recordId: id, ask: 'question:agent', choice: 'drop-criteria', criteria: ['c2', 'c3'] }
    expect(outcome.input).toMatchObject(wanted)
    expect(await eventCount(id)).toBe(before)
    expect((await readRecord(e.db.payload, id)).record.criteria).toHaveLength(3)
    const shown = await texts(id)
    expect(shown[0]).toEqual(['user', 'drop the email criteria'])
    const { number } = await ticket(e.db.payload, { workspace: e.db.workspace, recordId: id })
    expect(shown[1]?.[1]).toContain(`I will drop c2, c3 from #${number}`)
    await decide(id, e.owner, outcome.input, e.deps())
    expect((await readRecord(e.db.payload, id)).record.criteria.map((c) => c.id)).toEqual(['c1'])
  })

  it('answers a question in plain words without an intent', async () => {
    const id = await toVerifyQuestion()
    const before = await eventCount(id)
    const { deps } = dependsOn([reply({ say: 'The first answer was a draft.', tool: 'answer' })])
    expect(await say(id, 'Why did Verify ask twice?', deps)).toEqual({ kind: 'answer' })
    expect(await texts(id)).toEqual([
      ['user', 'Why did Verify ask twice?'],
      ['assistant', 'The first answer was a draft.'],
    ])
    expect(await eventCount(id)).toBe(before)
  })

  it('treats a model reply that is not JSON as a plain answer', async () => {
    const id = await toVerifyQuestion()
    const { deps } = dependsOn(['It asked twice because the first answer was a draft.'])
    expect(await say(id, 'Why?', deps)).toEqual({ kind: 'answer' })
    expect((await texts(id)).at(-1)?.[1]).toBe('It asked twice because the first answer was a draft.')
  })

  it('refuses an option the ticket does not ask, and a drop of every criterion', async () => {
    const id = await toVerifyQuestion()
    const unknown = dependsOn([reply({ say: 'Done.', tool: 'approve' })])
    expect(await say(id, 'approve it', unknown.deps)).toEqual({ kind: 'answer' })
    expect((await texts(id)).at(-1)?.[1]).toContain('I cannot do that')
    const every = dependsOn([reply({ say: 'All of them.', tool: 'drop-criteria', criteria: ['c1', 'c2', 'c3'] })])
    expect(await say(id, 'drop everything', every.deps)).toEqual({ kind: 'answer' })
    expect((await texts(id)).at(-1)?.[1]).toContain('keep at least one')
  })

  it('hands words to the agent as a comment intent', async () => {
    const id = await toVerifyQuestion()
    const before = await eventCount(id)
    const note = 'Skip the email checks.'
    const { deps } = dependsOn([reply({ say: 'I pass that on.', tool: 'comment_to_agent', note })])
    expect(await say(id, 'tell the agent to skip emails', deps)).toEqual({ kind: 'comment', body: note })
    expect(await eventCount(id)).toBe(before)
  })

  it('falls back to a comment and says so when the model fails', async () => {
    const id = await toVerifyQuestion()
    const { deps, calls } = dependsOn([new Error('GATEWAY_URL is empty')])
    expect(await say(id, 'please hurry', deps)).toEqual({ kind: 'fallback', error: null })
    expect(calls.comments).toEqual(['please hurry'])
    expect(await texts(id)).toEqual([['assistant', FALLBACK_NOTE]])
  })

  it('keeps one conversation per ticket and sends its history to the next turn', async () => {
    const id = await toVerifyQuestion()
    const { deps, calls } = dependsOn([reply({ say: 'One.', tool: 'answer' }), reply({ say: 'Two.', tool: 'answer' })])
    await say(id, 'first?', deps)
    await say(id, 'second?', deps)
    expect(calls.prompts.map((p) => p.turns)).toEqual([1, 3])
    const found = await e.db.payload.db.drizzle.execute(
      sql`SELECT count(*)::int AS n FROM "conversations" WHERE "record_id" = ${id}`,
    )
    expect(found.rows[0]?.n).toBe(1)
    expect(await texts(id)).toHaveLength(4)
  })

  it('keeps the prompt small', async () => {
    const id = await toVerifyQuestion()
    const view = await ticket(e.db.payload, { workspace: e.db.workspace, recordId: id })
    const size = systemOf(view).length
    expect(size).toBeLessThan(2500)
  })
})
