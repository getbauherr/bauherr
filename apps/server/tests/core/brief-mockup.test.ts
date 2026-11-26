import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { receiveUpload } from '../../src/core/attachments/store'
import { readRecord } from '../../src/core/record/store'
import { MODULES } from '../../src/lean'
import { PNG } from './images'
import { openMcp, type Mcp } from './mcp-harness'
import { TEST_MODULES } from './harness'
import { BRIEF } from './modules-harness'

let m: Mcp
beforeAll(async () => {
  m = await openMcp('core_brief_mockup', { ...TEST_MODULES, brief: MODULES.brief ?? TEST_MODULES.brief })
  m.e.clock.now = new Date()
}, 120_000)
afterAll(async () => {
  await m?.e.drop()
})

const briefRun = async () => {
  await m.e.drain()
  const record = await m.begin()
  const intake = await m.claimed(m.alpha)
  const accept = { runId: intake.runId, leaseToken: intake.leaseToken, result: { verdict: 'accept' } }
  await m.call('submit', accept, m.agent(m.alpha))
  const brief = await m.claimed(m.alpha)
  return { record, ids: { runId: brief.runId, leaseToken: brief.leaseToken } }
}

const submit = (ids: { runId: number; leaseToken: string }, visible: boolean) =>
  m.call('submit', { ...ids, result: { ...BRIEF, visible } }, m.agent(m.alpha))

const attachMockup = async (ids: { runId: number; leaseToken: string }) => {
  const input = { ...ids, kind: 'mockup', upload: { contentType: 'image/png', caption: 'The new list' } }
  const out = z.object({ uploadUrl: z.string() }).parse(await m.call('attach_proof', input, m.agent(m.alpha)))
  await receiveUpload(m.e.db.payload, out.uploadUrl.slice(out.uploadUrl.lastIndexOf('/') + 1), PNG, m.e.clock.now)
}

describe('a Brief without a shape view', () => {
  it('is refused with a message that says what to add, and keeps the shape once given', async () => {
    const { record, ids } = await briefRun()
    const without = { ...BRIEF, shape: '' }
    const refused = z
      .object({ status: z.literal('retry'), problems: z.array(z.object({ path: z.string(), message: z.string() })) })
      .parse(await m.call('submit', { ...ids, result: without }, m.agent(m.alpha)))
    expect(refused.problems).toHaveLength(1)
    expect(refused.problems[0]?.path).toBe('shape')
    expect(refused.problems[0]?.message).toMatch(/add `shape`.*\+ for added and - for removed/)
    const flow = 'flowchart LR\n  A --> B'
    const options = [
      { id: 'a', label: 'A', preview: 'one row' },
      { id: 'b', label: 'B' },
    ]
    const given = { ...BRIEF, flow, decisions: [{ question: 'Which?', recommended: 'a', options }] }
    expect(await m.call('submit', { ...ids, result: given }, m.agent(m.alpha))).toEqual({ status: 'accepted' })
    const stored = (await readRecord(m.e.db.payload, record)).record
    expect(stored.shape).toBe(BRIEF.shape)
    expect(stored.flow).toBe(flow)
    expect(stored.decisions[0]?.options[0]?.preview).toBe('one row')
  })
})

describe('a Brief with constraints', () => {
  it('refuses a ~/ design path, and keeps the constraints once they link into the repository', async () => {
    const { record, ids } = await briefRun()
    const home = { ...BRIEF, constraints: ['Match the design in ~/.claude/plans/redesign.md'] }
    const refused = z
      .object({ status: z.literal('retry'), problems: z.array(z.object({ path: z.string(), message: z.string() })) })
      .parse(await m.call('submit', { ...ids, result: home }, m.agent(m.alpha)))
    expect(refused.problems[0]?.message).toMatch(/docs\/design\/mockups\//)
    const constraints = ['Use shadcn/ui and assistant-ui only', 'Design: docs/design/mockups/redesign/Inbox.dc.html']
    expect(await m.call('submit', { ...ids, result: { ...BRIEF, constraints } }, m.agent(m.alpha))).toEqual({
      status: 'accepted',
    })
    expect((await readRecord(m.e.db.payload, record)).record.constraints).toEqual(constraints)
  })
})

describe('a Brief with a state table', () => {
  const rows = ['done', 'failed', 'retried', 'given-up'].map((outcome) => ({
    step: 'deploy',
    outcome,
    test: `deploy is ${outcome}`,
  }))

  it('is refused when a row is missing, and keeps the table once it is complete', async () => {
    const { record, ids } = await briefRun()
    const refused = z
      .object({ status: z.literal('retry'), problems: z.array(z.object({ path: z.string(), message: z.string() })) })
      .parse(await m.call('submit', { ...ids, result: { ...BRIEF, stateTable: rows.slice(0, 3) } }, m.agent(m.alpha)))
    expect(refused.problems[0]?.message).toContain('step "deploy" has no row for given-up')
    const complete = { ...BRIEF, stateTable: rows }
    expect(await m.call('submit', { ...ids, result: complete }, m.agent(m.alpha))).toEqual({ status: 'accepted' })
    expect((await readRecord(m.e.db.payload, record)).record.stateTable).toEqual(rows)
  })
})

describe('a Brief for a visible change', () => {
  it('is refused without a mockup, with the one fix turn, and accepted once a mockup is attached', async () => {
    const { record, ids } = await briefRun()
    const refused = z
      .object({ status: z.literal('retry'), problems: z.array(z.object({ path: z.string(), message: z.string() })) })
      .parse(await submit(ids, true))
    expect(refused.problems[0]?.path).toBe('visible')
    expect(refused.problems[0]?.message).toMatch(/no mockup/)
    expect((await m.e.view(record)).stage).toBe('brief')
    await attachMockup(ids)
    expect(await submit(ids, true)).toEqual({ status: 'accepted' })
    expect((await readRecord(m.e.db.payload, record)).record.visible).toBe(true)
  })

  it('goes to the owner as a Brief card although the risk rule alone would approve it', async () => {
    const { record, ids } = await briefRun()
    await attachMockup(ids)
    await submit(ids, true)
    expect(await m.e.view(record)).toMatchObject({
      stage: 'brief',
      waitingOn: 'owner',
      card: { card: 'brief', reason: 'visible-change' },
    })
  })

  it('counts only a mockup of its own run', async () => {
    const first = await briefRun()
    await attachMockup(first.ids)
    await m.call('release', first.ids, m.agent(m.alpha))
    const second = await briefRun()
    expect(await submit(second.ids, true)).toMatchObject({ status: 'retry' })
  })
})

describe('a Brief for a visible change worked by the Runner', () => {
  const executor = (value: string) =>
    m.e.db.payload.db.drizzle.execute(sql`UPDATE "products" SET "executor" = ${value} WHERE "id" = ${m.e.db.product}`)

  it('is accepted without a mockup and goes to the owner, while a session still gets it refused', async () => {
    const { record, ids } = await briefRun()
    await executor('runner')
    try {
      expect(await submit(ids, true)).toEqual({ status: 'accepted' })
      expect(await m.e.view(record)).toMatchObject({ waitingOn: 'owner', card: { reason: 'visible-change' } })
    } finally {
      await executor('session')
    }
    const session = await briefRun()
    expect(await submit(session.ids, true)).toMatchObject({ status: 'retry' })
  })
})

describe('a Brief for a change nobody sees', () => {
  it('needs no mockup and is approved by the rule as before', async () => {
    const { record, ids } = await briefRun()
    expect(await submit(ids, false)).toEqual({ status: 'accepted' })
    expect(await m.e.view(record)).toMatchObject({ stage: 'build', card: null })
  })
})
