import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { decide, StaleDecision, type Decision } from '../../src/core/decide'
import { advance } from '../../src/core/engine'
import { RunNotClaimed } from '../../src/core/run/errors'
import { claim } from '../../src/core/run/leases'
import { submit } from '../../src/core/submit'
import { openEngine, type Engine } from './harness'

let e: Engine
beforeAll(async () => {
  e = await openEngine('core_concurrency')
}, 120_000)
afterAll(async () => {
  await e?.drop()
})
beforeEach(async () => {
  await e.drain()
})

const answer = async (id: number, d: Omit<Decision, 'seq'>) =>
  decide(id, e.owner, { ...d, seq: await e.seq(id) }, e.deps())
const count = async (id: number, type: string) => (await e.view(id)).types.filter((t) => t === type).length

const toBrief = async (open: boolean, id?: number) => {
  const record = id ?? (await e.db.fresh())
  if (id === undefined) {
    await advance(record, e.deps())
    await e.work(record, 'builder', { verdict: 'accept' })
  }
  await e.work(record, 'builder', { goal: 'Fix it', open })
  return record
}

describe('decide', () => {
  it('lets exactly one of two identical concurrent decisions through', async () => {
    const id = await toBrief(true)
    const seq = await e.seq(id)
    const same = { ask: 'brief', choice: 'approve', seq }
    const results = await Promise.allSettled([decide(id, e.owner, same, e.deps()), decide(id, e.owner, same, e.deps())])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const refused = results.filter((r) => r.status === 'rejected')
    expect(refused).toHaveLength(1)
    expect(refused[0]?.reason).toBeInstanceOf(StaleDecision)
    expect(await count(id, 'brief.approved')).toBe(1)
    expect(await count(id, 'run.started')).toBe(3)
  })

  it('refuses the seq of an earlier Brief card when a later Brief card is open', async () => {
    const id = await toBrief(true)
    const earlier = await e.seq(id)
    await answer(id, { ask: 'brief', choice: 'request-changes', note: 'shorter' })
    await toBrief(true, id)
    const later = await e.seq(id)
    expect(later).toBeGreaterThan(earlier)
    const stale = { ask: 'brief', choice: 'approve', seq: earlier }
    await expect(decide(id, e.owner, stale, e.deps())).rejects.toThrow(StaleDecision)
    expect(await count(id, 'brief.approved')).toBe(0)
    await decide(id, e.owner, { ...stale, seq: later }, e.deps())
    expect(await count(id, 'brief.approved')).toBe(1)
  })

  it('keeps the seq of an open card across repeated advances', async () => {
    const id = await toBrief(true)
    const seq = await e.seq(id)
    await advance(id, e.deps())
    await advance(id, e.deps())
    expect(await e.seq(id)).toBe(seq)
  })
})

describe('submit', () => {
  it('lets exactly one of two concurrent submits for the same run through', async () => {
    const id = await e.db.fresh()
    await advance(id, e.deps())
    const claimed = await claim(e.db.payload, { workspace: e.db.workspace, role: 'builder', by: 'x', now: e.clock.now })
    if (!claimed) throw new Error('no run')
    const send = () => submit(claimed.run.id, claimed.token, { verdict: 'accept' }, e.deps())
    const results = await Promise.allSettled([send(), send()])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const refused = results.filter((r) => r.status === 'rejected')
    expect(refused[0]?.reason).toBeInstanceOf(RunNotClaimed)
    expect(await count(id, 'intake.accepted')).toBe(1)
    expect(await count(id, 'run.started')).toBe(2)
  })
})
