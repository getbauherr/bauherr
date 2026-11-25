import { sql } from '@payloadcms/db-postgres'
import { describe, expect, it } from 'vitest'
import { archive, restore } from '../../src/core/archive'
import { decide, InvalidDecision, NotAllowedToDecide } from '../../src/core/decide'
import { ticket } from '../../src/core/views/ticket'
import { BRIEF, flowHarness } from './modules-harness'

const f = flowHarness('core_archive_flow')

const owner = () => ({ id: 'u7', role: 'bauherr', workspaceIds: [f.h.ids.workspace], name: 'sam@example.com' })

const inBuild = async () => {
  const s = await f.start('active')
  await f.work(s.id, 'builder', { outcome: 'accepted', type: 'bug', reason: 'clear' })
  await f.work(s.id, 'builder', BRIEF)
  return s
}

const live = (id: number) =>
  f.h.rows(
    sql`SELECT "stage", "status" FROM "stage_runs" WHERE "record_id" = ${id} AND "status" IN ('queued', 'claimed')`,
  )

const page = (id: number) => ticket(f.h.payload(), { workspace: f.h.ids.workspace, recordId: id })

const issue = (repo: string) => f.fake().tickets(repo).get('1')

describe('archiving a ticket', () => {
  it('releases the live run, clears the card and records the reason', async () => {
    const s = await inBuild()
    expect(await live(s.id)).toHaveLength(1)
    await archive(s.id, owner(), f.subDeps())
    expect(await live(s.id)).toHaveLength(0)
    expect(await f.view(s.id)).toMatchObject({ waitingOn: 'nobody', card: null })
    const events = await f.h.rows(
      sql`SELECT "data" FROM "events" WHERE "record_id" = ${s.id} AND "type" = 'ticket.closed'`,
    )
    expect(events.map((e) => e.data)).toEqual([{ reason: 'archived' }])
    expect(await f.types(s.id)).toContain('run.released')
  })

  it('closes the issue as not planned with a comment naming who archived it', async () => {
    const s = await inBuild()
    await archive(s.id, owner(), f.subDeps())
    expect((await f.comments(s.repo)).some((c) => c.body.includes('Archived by sam@example.com'))).toBe(true)
    expect(await issue(s.repo)).toMatchObject({ state: 'closed', closeReason: 'not_planned' })
  })

  it('is refused for a person who may not decide', async () => {
    const s = await inBuild()
    const outsider = { ...owner(), workspaceIds: [] }
    await expect(archive(s.id, outsider, f.subDeps())).rejects.toBeInstanceOf(NotAllowedToDecide)
  })

  it('cannot be archived twice', async () => {
    const s = await inBuild()
    await archive(s.id, owner(), f.subDeps())
    await expect(archive(s.id, owner(), f.subDeps())).rejects.toBeInstanceOf(InvalidDecision)
  })
})

describe('restoring an archived ticket', () => {
  it('reopens the issue and queues the stage the ticket was in', async () => {
    const s = await inBuild()
    await archive(s.id, owner(), f.subDeps())
    await restore(s.id, owner(), f.subDeps())
    expect(await issue(s.repo)).toMatchObject({ state: 'open' })
    expect(await f.view(s.id)).toMatchObject({ stage: 'build', waitingOn: 'agents' })
    expect(await live(s.id)).toEqual([{ stage: 'build', status: 'queued' }])
    expect((await f.claimRun(s.id, 'builder')).run.stage).toBe('build')
  })

  it('is refused for a ticket that is not archived', async () => {
    const s = await inBuild()
    await expect(restore(s.id, owner(), f.subDeps())).rejects.toBeInstanceOf(InvalidDecision)
  })

  it('restores once when the sync sees the issue open again after its own reopen', async () => {
    const s = await inBuild()
    await archive(s.id, owner(), f.subDeps())
    await s.sync()
    await restore(s.id, owner(), f.subDeps())
    await s.sync()
    await s.sync()
    expect((await f.types(s.id)).filter((t) => t === 'ticket.restored')).toHaveLength(1)
    expect((await f.types(s.id)).filter((t) => t === 'ticket.closed')).toHaveLength(1)
  })
})

describe('reopening an archived issue on the forge', () => {
  it('restores the ticket on the next sync and queues the archived stage', async () => {
    const s = await inBuild()
    await archive(s.id, owner(), f.subDeps())
    await s.sync()
    expect(await live(s.id)).toHaveLength(0)
    await f.fake().tickets(s.repo).reopen('1')
    await s.sync()
    await s.sync()
    expect((await f.types(s.id)).filter((t) => t === 'ticket.restored')).toHaveLength(1)
    expect(await live(s.id)).toEqual([{ stage: 'build', status: 'queued' }])
  })

  it('leaves an archived ticket of an observing Product alone', async () => {
    const s = await f.start('observing')
    await archive(s.id, owner(), f.subDeps())
    await s.sync()
    await s.sync()
    expect(await f.types(s.id)).not.toContain('ticket.restored')
  })
})

describe('restoring a ticket closed on the forge', () => {
  const closedOnForge = async () => {
    const s = await inBuild()
    await f.fake().tickets(s.repo).close('1', 'completed')
    await s.sync()
    expect(await f.types(s.id)).toContain('ticket.closed')
    return s
  }

  it('reopens the issue and keeps the stage', async () => {
    const s = await closedOnForge()
    await restore(s.id, owner(), f.subDeps())
    expect(await issue(s.repo)).toMatchObject({ state: 'open' })
    expect(await f.view(s.id)).toMatchObject({ stage: 'build', waitingOn: 'agents' })
    expect(await page(s.id)).toMatchObject({ restorable: false })
    await s.sync()
    expect((await f.types(s.id)).filter((t) => t === 'ticket.closed')).toHaveLength(1)
  })

  it('shows Restore on the page only for the closed ticket', async () => {
    const s = await closedOnForge()
    expect(await page(s.id)).toMatchObject({ restorable: true, archived: false })
  })
})

describe('discarding a Brief', () => {
  it('also closes the issue as not planned with a comment naming who discarded it', async () => {
    const s = await f.start('active')
    await f.work(s.id, 'builder', { outcome: 'accepted', type: 'bug', reason: 'clear' })
    await f.work(s.id, 'builder', { ...BRIEF, risk: { door: 'one-way', areas: [], rollback: 'revert' } })
    const card = (await f.view(s.id)).card
    expect(card?.card).toBe('brief')
    await decide(s.id, owner(), { ask: 'brief', choice: 'discard', seq: card?.seq ?? -1 }, f.subDeps())
    expect((await f.comments(s.repo)).some((c) => c.body.includes('Discarded by sam@example.com'))).toBe(true)
    expect(await issue(s.repo)).toMatchObject({ state: 'closed', closeReason: 'not_planned' })
  })
})
