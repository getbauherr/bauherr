import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { InvalidDecision, StaleDecision } from '../../src/core/decide'
import { readEvents } from '../../src/core/record/store'
import { failRun } from '../../src/core/submit'
import { claim } from '../../src/core/run/leases'
import { openMcp, type Mcp } from './mcp-harness'

let m: Mcp
beforeAll(async () => {
  m = await openMcp('core_back_to_brief')
}, 120_000)
afterAll(async () => {
  await m?.e.drop()
})

const owner = () => m.person(m.alpha, [m.e.db.workspace])
const rows = async (query: ReturnType<typeof sql>) => (await m.e.db.payload.db.drizzle.execute(query)).rows
const types = async (record: number) => (await readEvents(m.e.db.payload, record)).map((e) => e.type)
const agent = () => m.agent(m.alpha)
const sendBack = (record: number, ask: string, seq: number, note = 'redo as a redesign') =>
  m.call('decide', { record, ask, choice: 'back-to-brief', seq, note }, owner())

type Claimed = Awaited<ReturnType<Mcp['claimed']>>
const submitAs = (run: Claimed, result: unknown) =>
  m.call('submit', { runId: run.runId, leaseToken: run.leaseToken, result }, agent())
const CLEAR = { goal: 'g', open: false }

const toBuild = async () => {
  await m.e.drain()
  const record = await m.begin()
  await submitAs(await m.claimed(m.alpha), { verdict: 'accept' })
  await submitAs(await m.claimed(m.alpha), CLEAR)
  return { record, build: await m.claimed(m.alpha) }
}

describe('back to Brief through decide and the MCP route', () => {
  it('ends the live Build run, refuses its calls, and hands the note to an owner Brief run', async () => {
    const { record, build } = await toBuild()
    const ids = { runId: build.runId, leaseToken: build.leaseToken }
    expect(await sendBack(record, 'working', 0)).toEqual({ status: 'decided' })
    const result = { patchId: 'p1', headSha: 'h1', pr: 3 }
    const gone = /went back to Brief/
    await expect(m.call('submit', { ...ids, result }, agent())).rejects.toThrow(gone)
    await expect(m.call('ask', { ...ids, question: 'q?', options: ['a', 'b'] }, agent())).rejects.toThrow(gone)
    await expect(m.call('heartbeat', ids, agent())).rejects.toThrow(gone)
    expect(await m.e.view(record)).toMatchObject({ stage: 'brief', waitingOn: 'agents', card: null })
    const live = await rows(sql`SELECT "stage", "status" FROM "stage_runs" WHERE "record_id" = ${record}
      AND "status" IN ('queued', 'claimed')`)
    expect(live).toEqual([{ stage: 'brief', status: 'queued' }])
    const again = await m.claimed(m.alpha)
    expect(again.context.note).toBe('redo as a redesign')
    await submitAs(again, { goal: 'g2', open: false })
    expect(await m.e.view(record)).toMatchObject({
      stage: 'brief',
      waitingOn: 'owner',
      card: { card: 'brief', reason: 'sent-back' },
    })
    const seq = await m.e.seq(record)
    await m.call('decide', { record, ask: 'brief', choice: 'approve', seq }, owner())
    expect(await m.e.view(record)).toMatchObject({ stage: 'build', waitingOn: 'agents' })
    await m.e.drain()
  })

  it('answers an agent question with the fixed action and needs a note', async () => {
    const { record, build } = await toBuild()
    const ids = { runId: build.runId, leaseToken: build.leaseToken }
    await m.call('ask', { ...ids, question: 'Which?', options: ['a', 'b'] }, agent())
    const seq = await m.e.seq(record)
    const bare = { record, ask: 'question:agent', choice: 'back-to-brief', seq }
    await expect(m.call('decide', bare, owner())).rejects.toThrow(InvalidDecision)
    await sendBack(record, 'question:agent', seq)
    expect((await types(record)).slice(-3)).toEqual(['question.answered', 'brief.changes-requested', 'run.started'])
    expect(await m.e.view(record)).toMatchObject({ stage: 'brief', waitingOn: 'agents', card: null })
    await m.e.drain()
  })

  it('is not offered in Intake, Brief or on a factory question', async () => {
    await m.e.drain()
    const record = await m.begin()
    await expect(sendBack(record, 'working', 0)).rejects.toThrow(StaleDecision)
    await submitAs(await m.claimed(m.alpha), { verdict: 'accept' })
    await expect(sendBack(record, 'working', 0)).rejects.toThrow(StaleDecision)
    await submitAs(await m.claimed(m.alpha), CLEAR)
    const claimBuild = () =>
      claim(m.e.db.payload, { workspace: m.e.db.workspace, role: 'builder', by: 'x', now: m.e.clock.now })
    for (let i = 0; i < m.e.config.caps.failedRuns; i++) {
      const run = await claimBuild()
      await failRun(run?.run.id ?? 0, run?.token ?? '', 'boom', m.e.deps())
    }
    const shown = await m.e.view(record)
    expect(shown.card).toMatchObject({ reason: 'failed-runs' })
    await expect(sendBack(record, 'question:failed-runs', await m.e.seq(record))).rejects.toThrow(InvalidDecision)
    await m.e.drain()
  })

  it('is not offered in Ship or Done', async () => {
    const { record, build } = await toBuild()
    await submitAs(build, { patchId: 'p1', headSha: 'h1', pr: 3 })
    await submitAs(await m.claimed(m.alpha, 'reviewer'), { patchId: 'p1', headSha: 'h1' })
    await m.e.checks(record)
    await submitAs(await m.claimed(m.alpha, 'verifier'), { passed: true, patchId: 'p1', headSha: 'h1' })
    expect(await m.e.view(record)).toMatchObject({ stage: 'ship', card: { card: 'result' } })
    await expect(sendBack(record, 'working', 0)).rejects.toThrow(StaleDecision)
    await expect(sendBack(record, 'result', await m.e.seq(record))).rejects.toThrow(InvalidDecision)
    const seq = await m.e.seq(record)
    await m.call('decide', { record, ask: 'result', choice: 'accept', seq }, owner())
    await expect(sendBack(record, 'working', 0)).rejects.toThrow(StaleDecision)
    expect(await m.e.view(record)).toMatchObject({ stage: 'done' })
  })
})
