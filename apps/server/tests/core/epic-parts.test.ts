import { sql } from '@payloadcms/db-postgres'
import { beforeEach, describe, expect, it } from 'vitest'
import { decide, InvalidDecision } from '../../src/core/decide'
import { advance } from '../../src/core/engine'
import type { AppEvent } from '../../src/core/events'
import { appendEvent, createRecord, readRecord } from '../../src/core/record/store'
import { loadTicketRelations } from '../../src/core/views/ticket-relations'
import { CONFIG, ev, merged } from './fixtures'
import { relationsHarness } from './relations-harness'

const { h, setup } = relationsHarness('epic_parts')

const deps = () => ({
  payload: h.payload(),
  configFor: () => Promise.resolve(CONFIG),
  now: new Date(),
  merge: () => Promise.resolve({ sha: 'sha' }),
})

const append = async (id: number, events: AppEvent[]) => {
  for (const event of events) await appendEvent(h.payload(), id, { ...event, actor: 'factory' })
}

const part = async (repo: string, number: number) =>
  (
    await createRecord(h.payload(), {
      workspace: h.ids.workspace,
      product: h.ids.product,
      source: { forge: 'github', repo, number, reporter: 'jo', external: false, backlog: false },
      type: 'bug',
    })
  ).id

const epicWithParts = async () => {
  const s = await setup(['epic', 'first part', 'second part'])
  const parts = [await part(s.repo, 2), await part(s.repo, 3)]
  for (const number of [2, 3]) {
    await s.writer.addRelation(s.record.id, { from: s.item(number), to: s.item(1), type: 'part-of' })
  }
  await append(s.record.id, merged)
  return { ...s, parts }
}

const finish = async (id: number) => {
  await append(id, [...merged, ev('result.accepted')])
  await advance(id, deps())
}

const stored = (id: number) => readRecord(h.payload(), id)

beforeEach(async () => {
  await h.rows(sql`DELETE FROM "events"`)
  await h.rows(sql`DELETE FROM "records"`)
  await h.rows(sql`UPDATE "products" SET "state" = 'active'`)
})

describe('an epic, a ticket that others are part of', () => {
  it('shows no Result card while a part is open and says which', async () => {
    const e = await epicWithParts()
    await finish(e.parts[0])
    await advance(e.record.id, deps())
    expect(await stored(e.record.id)).toMatchObject({
      stage: 'ship',
      waitingOn: 'nobody',
      card: null,
      parked: 'Waiting for parts #3',
    })
  })

  it('gets its Result card when the last part is Done', async () => {
    const e = await epicWithParts()
    await advance(e.record.id, deps())
    await finish(e.parts[0])
    expect((await stored(e.record.id)).card).toBeNull()
    await finish(e.parts[1])
    expect(await stored(e.record.id)).toMatchObject({ waitingOn: 'owner', card: { card: 'result' }, parked: null })
  })

  it('counts a closed part as finished', async () => {
    const e = await epicWithParts()
    await finish(e.parts[0])
    await advance(e.record.id, deps())
    await append(e.parts[1], [ev('ticket.closed', { reason: 'archived' })])
    await advance(e.parts[1], deps())
    expect(await stored(e.record.id)).toMatchObject({ waitingOn: 'owner', card: { card: 'result' } })
  })

  it('refuses to accept a Result card raised before another part was added', async () => {
    const e = await epicWithParts()
    await finish(e.parts[0])
    await finish(e.parts[1])
    const seq = (await stored(e.record.id)).card?.seq ?? 0
    await h.rows(sql`UPDATE "events" SET "type" = 'ticket.restored', "data" = '{}'::jsonb
      WHERE "record_id" = ${e.parts[1]} AND "type" = 'result.accepted'`)
    const owner = { id: 'u7', role: 'bauherr', workspaceIds: [h.ids.workspace] }
    const accept = decide(e.record.id, owner, { ask: 'result', choice: 'accept', seq }, deps())
    await expect(accept).rejects.toThrow(InvalidDecision)
    await expect(accept).rejects.toThrow('#3')
  })

  it('reports its progress on the ticket page', async () => {
    const e = await epicWithParts()
    await finish(e.parts[0])
    const view = await loadTicketRelations(h.payload(), h.ids.workspace, e.record.id)
    expect(view?.parts).toMatchObject({ done: 1, total: 2 })
    expect(view?.parts.tickets.map((t) => [t.number, t.finished])).toEqual([
      [2, true],
      [3, false],
    ])
  })
})
