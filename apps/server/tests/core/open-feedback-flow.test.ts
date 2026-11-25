import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { InvalidDecision } from '../../src/core/decide'
import { readEvents } from '../../src/core/record/store'
import { failRun } from '../../src/core/submit'
import { claim } from '../../src/core/run/leases'
import { openMcp, type Mcp } from './mcp-harness'

let m: Mcp
beforeAll(async () => {
  m = await openMcp('core_open_feedback')
}, 120_000)
afterAll(async () => {
  await m?.e.drop()
})

const owner = () => m.person(m.alpha, [m.e.db.workspace])
const agent = () => m.agent(m.alpha)
const types = async (record: number) => (await readEvents(m.e.db.payload, record)).map((e) => e.type)
const notes = async (record: number) =>
  (await readEvents(m.e.db.payload, record)).flatMap((e) => (e.type === 'owner.note' ? [e.data.note] : []))

type Claimed = Awaited<ReturnType<Mcp['claimed']>>
const submitAs = (run: Claimed, result: unknown) =>
  m.call('submit', { runId: run.runId, leaseToken: run.leaseToken, result }, agent())

const decideOn = async (record: number, ask: string, choice: string, note?: string, answers?: object) =>
  m.call(
    'decide',
    { record, ask, choice, seq: await m.e.seq(record), ...(note ? { note } : {}), ...(answers ? { answers } : {}) },
    owner(),
  )

const toBuild = async () => {
  await m.e.drain()
  const record = await m.begin()
  await submitAs(await m.claimed(m.alpha), { verdict: 'accept' })
  await submitAs(await m.claimed(m.alpha), { goal: 'g', open: false })
  return { record, build: await m.claimed(m.alpha) }
}

const askAgent = async () => {
  const { record, build } = await toBuild()
  const ids = { runId: build.runId, leaseToken: build.leaseToken }
  await m.call('ask', { ...ids, question: 'Which?', options: ['a', 'b'] }, agent())
  return record
}

describe('a free answer to an agent question', () => {
  it('needs text, is refused on a factory question, and runs the stage again with the answer', async () => {
    const record = await askAgent()
    await expect(decideOn(record, 'question:agent', 'own-answer')).rejects.toThrow(InvalidDecision)
    await decideOn(record, 'question:agent', 'own-answer', 'Neither: use a queue')
    expect((await types(record)).slice(-3)).toEqual(['question.answered', 'owner.note', 'run.started'])
    expect(await notes(record)).toEqual(['Question: Which?\nAnswer: Neither: use a queue'])
    expect((await m.claimed(m.alpha)).context.note).toBe('Question: Which?\nAnswer: Neither: use a queue')
  })

  it('is not an option of a factory question', async () => {
    await m.e.drain()
    const record = await m.begin()
    await submitAs(await m.claimed(m.alpha), { verdict: 'accept' })
    await submitAs(await m.claimed(m.alpha), { goal: 'g', open: false })
    for (let i = 0; i < m.e.config.caps.failedRuns; i++) {
      const run = await claim(m.e.db.payload, {
        workspace: m.e.db.workspace,
        role: 'builder',
        by: 'x',
        now: m.e.clock.now,
      })
      await failRun(run?.run.id ?? 0, run?.token ?? '', 'boom', m.e.deps())
    }
    await expect(decideOn(record, 'question:failed-runs', 'own-answer', 'my answer')).rejects.toThrow(InvalidDecision)
    await decideOn(record, 'question:failed-runs', 'retry', 'The cache was stale.')
    expect((await m.claimed(m.alpha)).context.note).toBe('The cache was stale.')
    await m.e.drain()
  })
})

describe('a comment with a choice', () => {
  it('goes with an agent option into the next run', async () => {
    const record = await askAgent()
    await decideOn(record, 'question:agent', 'a', 'but keep it small')
    expect((await m.claimed(m.alpha)).context.note).toBe('Question: Which?\nAnswer: a\nbut keep it small')
  })

  it('goes with the approval of a Brief into the Build run, not into another Brief run', async () => {
    await m.e.drain()
    const record = await m.begin()
    await submitAs(await m.claimed(m.alpha), { verdict: 'accept' })
    await submitAs(await m.claimed(m.alpha), { goal: 'g', open: true })
    await decideOn(record, 'brief', 'approve', 'Mind the migration.', { d1: 'a' })
    expect(await types(record)).toContain('owner.note')
    expect(await m.e.view(record)).toMatchObject({ stage: 'build', waitingOn: 'agents' })
    const build = await m.claimed(m.alpha)
    expect(build.context.note).toBe('Mind the migration.')
    await m.e.drain()
  })

  it('stays in the Activity when the choice starts no run', async () => {
    await m.e.drain()
    const record = await m.begin()
    await submitAs(await m.claimed(m.alpha), { verdict: 'accept' })
    await submitAs(await m.claimed(m.alpha), { goal: 'g', open: true })
    await decideOn(record, 'brief', 'discard', 'Not needed any more.')
    const all = await types(record)
    expect(all.slice(all.lastIndexOf('brief.discarded'))).toEqual(['brief.discarded', 'owner.note'])
    expect(await notes(record)).toEqual(['Not needed any more.'])
  })
})
