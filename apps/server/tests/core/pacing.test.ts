import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { decide } from '../../src/core/decide'
import { advance } from '../../src/core/engine'
import { pacing, resumeParked } from '../../src/core/intake/pacing'
import { createRecord, readRecord, setRank } from '../../src/core/record/store'
import { openEngine, type Engine } from './harness'
import { source } from './fixtures'

let e: Engine
beforeAll(async () => {
  e = await openEngine('core_pacing')
  const base = e.deps
  e.deps = () => ({ ...base(), mayStart: pacing(e.db.payload) })
}, 120_000)
afterAll(async () => {
  await e?.drop()
})

let n = 0
const deps = () => e.deps()
const limit = (value: number) =>
  e.db.payload.db.drizzle.execute(sql`UPDATE "products" SET "backlog_brief_limit" = ${value}`)

beforeEach(async () => {
  for (const table of ['events', 'stage_runs', 'records']) {
    await e.db.payload.db.drizzle.execute(sql`DELETE FROM ${sql.identifier(table)}`)
  }
  await limit(5)
})

const ticket = async (backlog: boolean) => {
  const input = {
    workspace: e.db.workspace,
    product: e.db.product,
    source: { ...source, number: 5000 + ++n, backlog },
    type: 'bug' as const,
  }
  return (await createRecord(e.db.payload, input)).id
}

const toBrief = async (backlog: boolean) => {
  const id = await ticket(backlog)
  await advance(id, deps())
  const claimed = await e.work(id, 'builder', { verdict: 'accept' })
  expect(claimed.status).toBe('accepted')
  return id
}

const view = async (id: number) => {
  const stored = await readRecord(e.db.payload, id)
  return { stage: stored.stage, waitingOn: stored.waitingOn, parked: stored.parked }
}

const withCards = async (count: number) => {
  const ids: number[] = []
  for (let i = 0; i < count; i++) {
    const id = await toBrief(true)
    await e.work(id, 'builder', { goal: 'Fix it', open: false })
    ids.push(id)
  }
  return ids
}

const approve = async (id: number) => {
  const seq = await e.seq(id)
  await decide(id, e.owner, { ask: 'brief', choice: 'approve', seq }, deps())
}

describe('pacing of backlog Briefs', () => {
  it('lets five backlog Briefs wait on the owner and parks the sixth with a reason', async () => {
    const cards = await withCards(5)
    expect((await view(cards[0] ?? 0)).waitingOn).toBe('owner')
    expect((await readRecord(e.db.payload, cards[0] ?? 0)).card).toMatchObject({ card: 'brief', reason: 'backlog' })
    const sixth = await toBrief(true)
    expect(await view(sixth)).toMatchObject({ stage: 'brief', waitingOn: 'nobody' })
    expect((await view(sixth)).parked).toMatch(/5 Brief cards/)
  })

  it('never parks a ticket that is not a backlog ticket', async () => {
    await withCards(5)
    const fresh = await toBrief(false)
    expect(await view(fresh)).toMatchObject({ stage: 'brief', waitingOn: 'agents', parked: null })
  })

  it('counts a Brief run in flight as a slot, so the limit holds before the cards appear', async () => {
    const ids: number[] = []
    for (let i = 0; i < 6; i++) {
      const id = await ticket(true)
      await advance(id, deps())
      ids.push(id)
    }
    for (const id of ids) await e.work(id, 'builder', { verdict: 'accept' })
    expect((await view(ids[4] ?? 0)).waitingOn).toBe('agents')
    expect((await view(ids[5] ?? 0)).parked).not.toBeNull()
  })

  it('follows the Product limit', async () => {
    await limit(1)
    await withCards(1)
    expect((await view(await toBrief(true))).parked).not.toBeNull()
  })

  it('resumes the parked ticket with the lowest rank when a backlog Brief card is decided', async () => {
    const cards = await withCards(5)
    const later = await toBrief(true)
    const first = await toBrief(true)
    await setRank(e.db.payload, later, 2)
    await setRank(e.db.payload, first, 1)
    await approve(cards[0] ?? 0)
    expect(await view(first)).toMatchObject({ waitingOn: 'agents', parked: null })
    expect((await view(later)).parked).not.toBeNull()
    await approve(cards[1] ?? 0)
    expect(await view(later)).toMatchObject({ waitingOn: 'agents', parked: null })
  })

  it('resumes through resumeParked on its own when a slot is free', async () => {
    const cards = await withCards(5)
    const parked = await toBrief(true)
    await e.db.payload.db.drizzle.execute(sql`UPDATE "records" SET "card" = NULL WHERE "id" = ${cards[0] ?? 0}`)
    await resumeParked(deps(), null)
    expect((await view(parked)).parked).toBeNull()
  })
})
