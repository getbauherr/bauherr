import { sql } from '@payloadcms/db-postgres'
import { beforeEach, describe, expect, it } from 'vitest'
import { relationsHarness } from './relations-harness'

const { h, setup, edges } = relationsHarness('relations_forge')

beforeEach(async () => {
  await h.rows(sql`DELETE FROM "events"`)
  await h.rows(sql`DELETE FROM "records"`)
  await h.rows(sql`UPDATE "products" SET "state" = 'active'`)
})

describe('a blocked-by link', () => {
  it('set on the forge is stored after the next sync (c1)', async () => {
    const s = await setup()
    await s.tickets.addBlockedBy('2', '1')
    expect(await edges()).toEqual([])
    await s.sync()
    expect(await edges()).toEqual([{ from: s.item(1), to: s.item(2), type: 'blocks' }])
  })

  it('set in the factory reaches the forge and is stored (c1)', async () => {
    const s = await setup()
    await s.writer.addRelation(s.record.id, { from: s.item(2), to: s.item(3), type: 'blocks' })
    expect((await s.tickets.get('3')).blockedBy).toEqual(['2'])
    expect(await edges()).toEqual([{ from: s.item(2), to: s.item(3), type: 'blocks' }])
  })

  it('is added once when the write is repeated', async () => {
    const s = await setup()
    const edge = { from: s.item(2), to: s.item(3), type: 'blocks' }
    await s.writer.addRelation(s.record.id, edge)
    await s.writer.addRelation(s.record.id, edge)
    expect((await s.tickets.get('3')).blockedBy).toEqual(['2'])
    expect(await edges()).toHaveLength(1)
  })

  it('removed on the forge is removed in the factory after the next sync (c5)', async () => {
    const s = await setup()
    await s.tickets.addBlockedBy('2', '1')
    await s.sync()
    await s.tickets.removeBlockedBy('2', '1')
    await s.sync()
    expect(await edges()).toEqual([])
  })

  it('removed in the factory is removed on the forge (c5)', async () => {
    const s = await setup()
    const edge = { from: s.item(1), to: s.item(2), type: 'blocks' }
    await s.writer.addRelation(s.record.id, edge)
    await s.writer.removeRelation(s.record.id, edge)
    expect((await s.tickets.get('2')).blockedBy).toEqual([])
    expect(await edges()).toEqual([])
  })
})

describe('a sub-issue link', () => {
  it('set on the forge is stored as part of after the next sync (c2)', async () => {
    const s = await setup()
    await s.tickets.addSubTicket('1', '2')
    await s.sync()
    expect(await edges()).toEqual([{ from: s.item(2), to: s.item(1), type: 'part-of' }])
  })

  it('set in the factory reaches the forge as a sub-issue (c2)', async () => {
    const s = await setup()
    await s.writer.addRelation(s.record.id, { from: s.item(3), to: s.item(1), type: 'part-of' })
    expect((await s.tickets.get('3')).parent).toBe('1')
    expect(await edges()).toEqual([{ from: s.item(3), to: s.item(1), type: 'part-of' }])
  })

  it('removed on the forge is removed in the factory after the next sync (c5)', async () => {
    const s = await setup()
    await s.tickets.addSubTicket('1', '2')
    await s.sync()
    await s.tickets.removeSubTicket('1', '2')
    await s.sync()
    expect(await edges()).toEqual([])
  })

  it('removed in the factory is removed on the forge (c5)', async () => {
    const s = await setup()
    const edge = { from: s.item(2), to: s.item(1), type: 'part-of' }
    await s.writer.addRelation(s.record.id, edge)
    await s.writer.removeRelation(s.record.id, edge)
    expect((await s.tickets.get('2')).parent).toBeNull()
    expect(await edges()).toEqual([])
  })
})

describe('a relation kept only in the factory', () => {
  it('survives a sync and needs no forge call', async () => {
    const s = await setup()
    await s.writer.addRelation(s.record.id, { from: s.item(3), to: s.item(1), type: 'relates-to' })
    await s.sync()
    expect(await edges()).toHaveLength(1)
  })
})
