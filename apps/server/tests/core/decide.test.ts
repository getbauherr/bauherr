import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  decide,
  InvalidDecision,
  mayDecide,
  NOTE_MAX,
  NotAllowedToDecide,
  StaleDecision,
  type Decision,
} from '../../src/core/decide'
import { DECISIONS } from '../../src/core/decisions'
import { advance } from '../../src/core/engine'
import { readEvents, readRecord } from '../../src/core/record/store'
import { statementsFor } from '../../src/core/statements'
import { openEngine, type Engine } from './harness'

type Row = [ask: string, choice: string, types: string[]]

const ROWS: Row[] = [
  ['brief', 'approve', ['brief.approved']],
  ['brief', 'request-changes', ['brief.changes-requested']],
  ['brief', 'discard', ['brief.discarded']],
  ['result', 'accept', ['result.accepted']],
  ['result', 'send-back', ['result.sent-back']],
  ['question:failed-runs', 'retry', ['question.answered']],
  ['question:failed-runs', 'retry-with-guidance', ['question.answered', 'owner.note']],
  ['question:failed-runs', 'discard', ['question.answered', 'ticket.closed']],
  ['question:parked', 'resume', ['question.answered']],
  ['question:parked', 'discard', ['question.answered', 'ticket.closed']],
  ['question:reporter-silent', 'close', ['question.answered', 'intake.closed']],
  ['question:reporter-silent', 'ask-again', ['question.answered']],
  ['question:reporter-silent', 'accept', ['question.answered', 'intake.accepted']],
  ['question:disputed', 'not-a-bug', ['question.answered', 'intake.closed']],
  ['question:disputed', 'accept', ['question.answered', 'intake.accepted']],
  ['question:disputed', 'ask-again', ['question.answered']],
  ['question:verify-rounds', 'one-more-round', ['question.answered']],
  ['question:verify-rounds', 'accept-as-is', ['question.answered', 'verify.overridden']],
  ['question:verify-rounds', 'discard', ['question.answered', 'ticket.closed']],
  ['question:deploy-stalled', 'check-again', ['question.answered']],
  ['question:deploy-stalled', 'continue', ['question.answered', 'ship.deployed']],
  ['question:production', 'approve', ['question.answered', 'production.approved']],
  ['question:production', 'hold', ['question.answered', 'production.held']],
  ['production-held', 'approve-production', ['production.approved']],
]

describe('the decision table', () => {
  it('has exactly the specified rows', () => {
    const have = Object.entries(DECISIONS).flatMap(([ask, choices]) => Object.keys(choices).map((c) => `${ask}/${c}`))
    expect(have.sort()).toEqual(ROWS.map(([ask, choice]) => `${ask}/${choice}`).sort())
  })

  it.each(ROWS)('%s %s appends the specified events', (ask, choice, types) => {
    const events = DECISIONS[ask]?.[choice]?.events({ note: 'because', patchId: 'p1', headSha: 'h1' }) ?? []
    expect(events.map((e) => e.type)).toEqual(types)
  })

  it('carries the note and the latest patch where the specification says so', () => {
    const note = (ask: string, choice: string) =>
      DECISIONS[ask]?.[choice]?.events({ note: 'because', patchId: 'p9', headSha: 'h9' }).map((e) => e.data)
    expect(note('brief', 'request-changes')).toEqual([{ note: 'because' }])
    expect(note('result', 'send-back')).toEqual([{ note: 'because' }])
    expect(note('question:failed-runs', 'retry-with-guidance')?.[1]).toEqual({ note: 'because' })
    expect(note('question:verify-rounds', 'accept-as-is')?.[1]).toEqual({ patchId: 'p9', headSha: 'h9' })
    expect(note('brief', 'approve')).toEqual([{ by: 'owner' }])
  })
})

let e: Engine
beforeAll(async () => {
  e = await openEngine('core_decide')
}, 120_000)
afterAll(async () => {
  await e?.drop()
})
beforeEach(async () => {
  await e.drain()
})

const atResultCard = async () => {
  const id = await e.db.fresh()
  await advance(id, e.deps())
  await e.work(id, 'builder', { verdict: 'accept' })
  await e.work(id, 'builder', { goal: 'Fix it', open: false })
  await e.work(id, 'builder', { patchId: 'p1', headSha: 'h1', pr: 1 })
  await e.checks(id)
  await e.work(id, 'verifier', { passed: true, patchId: 'p1', headSha: 'h1' })
  return id
}
const answer = async (id: number, d: Omit<Decision, 'seq'>) =>
  decide(id, e.owner, { ...d, seq: await e.seq(id) }, e.deps())
const eventCount = async (id: number) => (await readEvents(e.db.payload, id)).length

describe('decide', () => {
  it('refuses a stale decision and changes nothing', async () => {
    const id = await atResultCard()
    const before = await eventCount(id)
    const stale = { ask: 'brief', choice: 'approve' }
    await expect(answer(id, stale)).rejects.toThrow(StaleDecision)
    await expect(answer(id, { ask: 'question:production', choice: 'approve' })).rejects.toThrow(
      StaleDecision,
    )
    expect(await eventCount(id)).toBe(before)
  })

  it('refuses a decision while the ticket asks nothing of the owner', async () => {
    const id = await e.db.fresh()
    await advance(id, e.deps())
    await expect(answer(id, { ask: 'result', choice: 'accept' })).rejects.toThrow(StaleDecision)
  })

  it('refuses a choice the card does not offer, and a missing or oversized note', async () => {
    const id = await atResultCard()
    const before = await eventCount(id)
    await expect(answer(id, { ask: 'result', choice: 'approve' })).rejects.toThrow(InvalidDecision)
    await expect(answer(id, { ask: 'result', choice: 'send-back' })).rejects.toThrow(InvalidDecision)
    const blank = { ask: 'result', choice: 'send-back', note: '   ' }
    await expect(answer(id, blank)).rejects.toThrow(InvalidDecision)
    const long = { ask: 'result', choice: 'send-back', note: 'x'.repeat(NOTE_MAX + 1) }
    await expect(answer(id, long)).rejects.toThrow(InvalidDecision)
    const tooLongAnyway = { ask: 'result', choice: 'accept', note: 'x'.repeat(NOTE_MAX + 1) }
    await expect(answer(id, tooLongAnyway)).rejects.toThrow(InvalidDecision)
    expect(await eventCount(id)).toBe(before)
  })

  it('stamps its events with the owner and the person, then advances', async () => {
    const id = await atResultCard()
    await answer(id, { ask: 'result', choice: 'send-back', note: 'x'.repeat(NOTE_MAX) })
    const events = await readEvents(e.db.payload, id)
    const sentBack = events.find((event) => event.type === 'result.sent-back')
    expect(sentBack).toMatchObject({ actor: 'owner', actorId: 'u7' })
    expect(events.at(-1)?.type).toBe('run.started')
    expect(await e.view(id)).toMatchObject({ stage: 'build', waitingOn: 'agents' })
  })

  it('refuses the same decision twice', async () => {
    const id = await atResultCard()
    await answer(id, { ask: 'result', choice: 'accept' })
    await expect(answer(id, { ask: 'result', choice: 'accept' })).rejects.toThrow(StaleDecision)
  })
})

describe('answers to open decisions', () => {
  const atOpenBrief = async () => {
    const id = await e.db.fresh()
    await advance(id, e.deps())
    await e.work(id, 'builder', { verdict: 'accept' })
    await e.work(id, 'builder', { goal: 'Fix it', open: true })
    return id
  }
  const approve = (id: number, answers?: Record<string, string>) =>
    answer(id, { ask: 'brief', choice: 'approve', ...(answers === undefined ? {} : { answers }) })

  it('refuses an approval that leaves an open decision unanswered or picks a foreign option', async () => {
    const id = await atOpenBrief()
    const before = await eventCount(id)
    await expect(approve(id)).rejects.toThrow(InvalidDecision)
    await expect(approve(id, {})).rejects.toThrow(InvalidDecision)
    await expect(approve(id, { d1: 'zzz' })).rejects.toThrow(InvalidDecision)
    await expect(approve(id, { d1: 'a', d9: 'a' })).rejects.toThrow(InvalidDecision)
    expect(await eventCount(id)).toBe(before)
    expect((await readRecord(e.db.payload, id)).record.decisions[0]?.answer).toBeUndefined()
  })

  it('writes the answers to the record and stores them as owner statements with the approval', async () => {
    const id = await atOpenBrief()
    await approve(id, { d1: 'b' })
    const stored = await readRecord(e.db.payload, id)
    expect(stored.record.decisions[0]).toMatchObject({ answer: 'b', by: 'owner' })
    expect(stored.record.decisions[0]?.at).toBe(e.clock.now.toISOString())
    const statements = await statementsFor(e.db.payload, e.db.product, 5)
    expect(statements.filter((s) => s.record === id).map((s) => [s.kind, s.text])).toEqual([
      ['answer', 'question 1: B'],
    ])
    expect(await e.view(id)).toMatchObject({ stage: 'build', waitingOn: 'agents' })
  })

  it('refuses answers on any other decision', async () => {
    const id = await atResultCard()
    await expect(answer(id, { ask: 'result', choice: 'accept', answers: { d1: 'a' } })).rejects.toThrow(
      InvalidDecision,
    )
  })
})

describe('who may decide', () => {
  const person = (role: string, workspaceIds: number[]) => ({ id: 'u1', role, workspaceIds })

  it('allows an Admin or a Bauherr of the Workspace and nobody else', () => {
    expect(mayDecide(person('admin', [1, 2]), 1)).toBe(true)
    expect(mayDecide(person('bauherr', [1]), 1)).toBe(true)
    expect(mayDecide(person('product-owner', [1]), 1)).toBe(false)
    expect(mayDecide(person('bauherr', [2]), 1)).toBe(false)
    expect(mayDecide(person('admin', []), 1)).toBe(false)
    expect(mayDecide(person('stranger', [1]), 1)).toBe(false)
  })

  it('refuses a Product owner and a member of another Workspace before touching anything', async () => {
    const id = await atResultCard()
    const before = await eventCount(id)
    const d = { ask: 'result', choice: 'accept', seq: await e.seq(id) }
    const ws = e.db.workspace
    const refused = [person('product-owner', [ws]), person('bauherr', [e.db.otherWorkspace]), person('admin', [])]
    for (const who of refused) {
      await expect(decide(id, who, d, e.deps())).rejects.toThrow(NotAllowedToDecide)
    }
    expect(await eventCount(id)).toBe(before)
    await decide(id, person('admin', [ws]), d, e.deps())
    expect(await e.view(id)).toMatchObject({ stage: 'done' })
  })
})
