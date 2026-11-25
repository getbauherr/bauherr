import { describe, expect, it } from 'vitest'
import { decide } from '../../src/core/decide'
import { BRIEF, flowHarness } from './modules-harness'

const f = flowHarness('core_brief_relations_flow')

const ACCEPTED = { outcome: 'accepted', type: 'bug', reason: 'clear' }
const ONE_WAY = { door: 'one-way', areas: [], rollback: 'restore a backup' }
const RELATIONS = [
  { type: 'blocked-by', ticket: 2, reason: 'The table must exist first.' },
  { type: 'part-of', ticket: 3, reason: 'It is one step of the table rework.' },
]

const briefWithRelations = async (relations: unknown[]) => {
  const s = await f.start('active')
  const tickets = f.fake().tickets(s.repo)
  await tickets.create({ title: 'Add the table' })
  await tickets.create({ title: 'Rework the table' })
  await s.sync()
  await f.work(s.id, 'builder', ACCEPTED)
  const outcome = await f.work(s.id, 'builder', { ...BRIEF, risk: ONE_WAY, relations })
  return { ...s, tickets, outcome }
}

const approve = async (id: number, dropRelations?: number[]) => {
  const seq = (await f.view(id)).card?.seq ?? -1
  const owner = { id: 'u7', role: 'bauherr', workspaceIds: [f.h.ids.workspace] }
  const decision = { ask: 'brief', choice: 'approve', seq, ...(dropRelations ? { dropRelations } : {}) }
  await decide(id, owner, decision, f.subDeps())
}

describe('relations proposed by the Brief', () => {
  it('are kept on the record and, once approved, exist in the store and on the forge (c1, c2)', async () => {
    const s = await briefWithRelations(RELATIONS)
    expect(s.outcome).toEqual({ status: 'accepted' })
    expect((await f.view(s.id)).record.relations).toEqual(RELATIONS)
    await approve(s.id)
    expect((await s.tickets.get('1')).blockedBy).toEqual(['2'])
    expect((await s.tickets.get('1')).parent).toBe('3')
    expect((await f.view(s.id)).record.relations).toEqual(RELATIONS)
  })

  it('leave only the kept ones when the owner removes one before approving (c3)', async () => {
    const s = await briefWithRelations(RELATIONS)
    await approve(s.id, [0])
    expect((await s.tickets.get('1')).blockedBy).toEqual([])
    expect((await s.tickets.get('1')).parent).toBe('3')
    expect((await f.view(s.id)).record.relations).toEqual([RELATIONS[1]])
  })

  it('are created without a card when the Brief is approved by rule', async () => {
    const s = await f.start('active')
    const tickets = f.fake().tickets(s.repo)
    await tickets.create({ title: 'Add the table' })
    await s.sync()
    await f.work(s.id, 'builder', ACCEPTED)
    await f.work(s.id, 'builder', { ...BRIEF, relations: [RELATIONS[0]] })
    expect((await f.view(s.id)).stage).toBe('build')
    expect((await tickets.get('1')).blockedBy).toEqual(['2'])
  })

  it('are refused at submit when a ticket would get two parents (f1)', async () => {
    const s = await briefWithRelations([
      { type: 'part-of', ticket: 2, reason: 'One step.' },
      { type: 'part-of', ticket: 3, reason: 'Another step.' },
    ])
    expect(JSON.stringify(s.outcome)).toContain('already is part of #2')
  })

  it('are refused at submit when a blocks relation would close a loop (f1)', async () => {
    const s = await f.start('active')
    const tickets = f.fake().tickets(s.repo)
    await tickets.create({ title: 'Blocked by this one' })
    await tickets.addBlockedBy('2', '1')
    await s.sync()
    await f.work(s.id, 'builder', ACCEPTED)
    const outcome = await f.work(s.id, 'builder', {
      ...BRIEF,
      relations: [{ type: 'blocked-by', ticket: 2, reason: 'Needs it.' }],
    })
    expect(JSON.stringify(outcome)).toContain('close a loop')
  })

  it('are refused at submit when the ticket does not exist', async () => {
    const s = await f.start('active')
    await f.work(s.id, 'builder', ACCEPTED)
    const outcome = await f.work(s.id, 'builder', {
      ...BRIEF,
      relations: [{ type: 'blocked-by', ticket: 99, reason: 'Needs it.' }],
    })
    expect(JSON.stringify(outcome)).toContain('#99 is not another ticket')
  })

  it('cannot be dropped by an index the Brief does not list', async () => {
    const s = await briefWithRelations(RELATIONS)
    await expect(approve(s.id, [5])).rejects.toThrow('does not propose')
  })
})
