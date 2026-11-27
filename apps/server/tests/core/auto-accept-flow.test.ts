import { sql } from '@payloadcms/db-postgres'
import { beforeEach, describe, expect, it } from 'vitest'
import { decide } from '../../src/core/decide'
import { advance } from '../../src/core/engine'
import type { AppEvent } from '../../src/core/events'
import { appendEvent, createRecord, readEvents, readRecord } from '../../src/core/record/store'
import { criterion, CONFIG, ev, merged } from './fixtures'
import { relationsHarness } from './relations-harness'

const { h, setup } = relationsHarness('auto_accept_flow')

const deps = () => ({
  payload: h.payload(),
  configFor: () => Promise.resolve(CONFIG),
  now: new Date(),
  merge: () => Promise.resolve({ sha: 'sha' }),
})

const OWNER = { id: 'u7', role: 'bauherr', workspaceIds: [] as number[] }

const append = async (id: number, events: AppEvent[], actor: 'factory' | 'owner' = 'factory') => {
  for (const event of events) await appendEvent(h.payload(), id, { ...event, actor })
}

const writeRecord = async (id: number, change: Record<string, unknown>) => {
  const { record } = await readRecord(h.payload(), id)
  const data = JSON.stringify({ ...record, ...change })
  await h.rows(sql`UPDATE "records" SET "data" = ${data}::jsonb WHERE "id" = ${id}`)
}

const LOW_RISK = {
  criteria: [1, 2].map((n) => criterion(n, { status: 'met' as const })),
  risk: { door: 'two-way' as const, areas: [], rollback: 'revert' },
}

const history = async (repo: string, first: number, accepted: number, sentBack: number) => {
  for (let i = 0; i < accepted; i++) {
    const record = await createRecord(h.payload(), {
      workspace: h.ids.workspace,
      product: h.ids.product,
      source: { forge: 'github', repo, number: first + i, reporter: 'jo', external: false, backlog: false },
      type: 'bug',
    })
    const back = i < sentBack ? [ev('result.sent-back')] : []
    await append(record.id, [ev('intake.accepted'), ...back, ev('result.accepted')], 'owner')
  }
}

const turnOn = (max = 10) =>
  h.rows(sql`UPDATE "products" SET "auto_accept" = true, "auto_accept_max_send_back" = ${max}`)

const atResult = async (change: Record<string, unknown> = LOW_RISK) => {
  const s = await setup(['subject'])
  await writeRecord(s.record.id, change)
  await append(s.record.id, merged)
  return s
}

const acceptedEvents = async (id: number) =>
  (await readEvents(h.payload(), id)).filter((event) => event.type === 'result.accepted')

beforeEach(async () => {
  await h.rows(sql`DELETE FROM "events"`)
  await h.rows(sql`DELETE FROM "records"`)
  await h.rows(sql`UPDATE "products" SET "state" = 'active', "auto_accept" = false,
    "auto_accept_max_send_back" = 10`)
  OWNER.workspaceIds = [h.ids.workspace]
})

describe('a Result the factory may accept', () => {
  it('goes to the owner as a card while the Product setting is off', async () => {
    const s = await atResult()
    await history(s.repo, 100, 10, 0)
    await advance(s.record.id, deps())
    expect((await readRecord(h.payload(), s.record.id)).card).toMatchObject({ card: 'result' })
    expect(await acceptedEvents(s.record.id)).toEqual([])
  })

  it('is accepted by the factory, never under the owner name, with the inputs it used', async () => {
    const s = await atResult()
    await history(s.repo, 100, 10, 1)
    await turnOn()
    await advance(s.record.id, deps())
    const [accepted] = await acceptedEvents(s.record.id)
    expect(accepted).toMatchObject({
      actor: 'factory',
      actorId: 'auto-accept',
      data: {
        auto: { door: 'two-way', criteriaMet: 2, criteriaTotal: 2, sendBackPercent: 10, maxSendBackPercent: 10 },
      },
    })
    const stored = await readRecord(h.payload(), s.record.id)
    expect(stored).toMatchObject({ stage: 'done', card: null })
    const actors = (await readEvents(h.payload(), s.record.id)).map((event) => event.actor)
    expect(actors).not.toContain('owner')
  })

  it.each([
    ['one-way door', { risk: { door: 'one-way', areas: [], rollback: 'restore' } }],
    ['unmet criterion', { criteria: [criterion(1, { status: 'met' }), criterion(2)] }],
    ['dropped criterion', { dropped: [{ id: 'c3', text: 'dropped', note: '' }] }],
  ])('goes to the owner on a %s', async (_name, change) => {
    const s = await atResult({ ...LOW_RISK, ...change })
    await history(s.repo, 100, 10, 0)
    await turnOn()
    await advance(s.record.id, deps())
    expect((await readRecord(h.payload(), s.record.id)).card).toMatchObject({ card: 'result' })
    expect(await acceptedEvents(s.record.id)).toEqual([])
  })

  it('goes to the owner when the ticket is labelled as needing the owner', async () => {
    const s = await atResult()
    await history(s.repo, 100, 10, 0)
    await turnOn()
    await h.rows(sql`UPDATE "mirror_items" SET "labels" = '["bauherr:needs-owner"]'::jsonb WHERE "number" = 1`)
    await advance(s.record.id, deps())
    expect((await readRecord(h.payload(), s.record.id)).card).toMatchObject({ card: 'result' })
  })

  it('goes to the owner above the send-back threshold and without history', async () => {
    const s = await atResult()
    await turnOn()
    await advance(s.record.id, deps())
    expect((await readRecord(h.payload(), s.record.id)).card).toMatchObject({ card: 'result' })
    await history(s.repo, 100, 10, 2)
    await advance(s.record.id, deps())
    expect(await acceptedEvents(s.record.id)).toEqual([])
  })

  it('goes to the owner when a visible change has no before and after pictures', async () => {
    const s = await atResult({ ...LOW_RISK, visible: true })
    await history(s.repo, 100, 10, 0)
    await turnOn()
    await advance(s.record.id, deps())
    expect((await readRecord(h.payload(), s.record.id)).card).toMatchObject({ card: 'result' })
  })

  it('still records the owner accepting a card as the owner decision', async () => {
    const s = await atResult()
    await advance(s.record.id, deps())
    const seq = (await readRecord(h.payload(), s.record.id)).card?.seq ?? 0
    await decide(s.record.id, OWNER, { ask: 'result', choice: 'accept', seq }, deps())
    const [accepted] = await acceptedEvents(s.record.id)
    expect(accepted).toMatchObject({ actor: 'owner', actorId: 'u7' })
    expect(accepted?.type === 'result.accepted' && accepted.data.auto).toBeUndefined()
  })
})
