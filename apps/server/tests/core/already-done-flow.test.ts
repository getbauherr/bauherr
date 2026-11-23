import { sql } from '@payloadcms/db-postgres'
import { describe, expect, it } from 'vitest'
import { decide } from '../../src/core/decide'
import { BRIEF, flowHarness } from './modules-harness'

const f = flowHarness('core_already_done_flow')

const DONE = { alreadyDone: { by: '#9', evidence: 'src/list.ts already returns the rows since #9' } }

const inBuild = async () => {
  const s = await f.start('active')
  await f.work(s.id, 'builder', { outcome: 'accepted', type: 'bug', reason: 'clear' })
  await f.work(s.id, 'builder', BRIEF)
  return s
}

const decideOn = async (id: number, choice: string) => {
  const owner = { id: 'u7', role: 'bauherr', workspaceIds: [f.h.ids.workspace] }
  const seq = (await f.view(id)).card?.seq ?? -1
  await decide(id, owner, { ask: 'question:already-done', choice, seq }, f.subDeps())
}

describe('a build run that finds its Ticket already done', () => {
  it('asks the owner whether to close it as done', async () => {
    const s = await inBuild()
    expect(await f.work(s.id, 'builder', DONE)).toEqual({ status: 'accepted' })
    expect(await f.view(s.id)).toMatchObject({
      stage: 'build',
      waitingOn: 'owner',
      card: {
        reason: 'already-done',
        options: ['close-as-done', 're-run-build'],
        text: 'Close #1 as done by #9?',
      },
    })
    expect(await f.types(s.id)).toContain('build.already-done')
  })

  it('closes the issue as completed with a comment naming the covering work', async () => {
    const s = await inBuild()
    await f.work(s.id, 'builder', DONE)
    await decideOn(s.id, 'close-as-done')
    const bodies = (await f.comments(s.repo)).map((c) => c.body)
    expect(bodies.some((b) => b.includes('#9') && b.includes('already returns the rows'))).toBe(true)
    expect((await f.fake().tickets(s.repo).get('1')).state).toBe('closed')
    expect(await f.view(s.id)).toMatchObject({ stage: 'done', waitingOn: 'nobody' })
    const live = await f.h.rows(
      sql`SELECT 1 FROM "stage_runs" WHERE "record_id" = ${s.id} AND "status" IN ('queued', 'claimed')`,
    )
    expect(live).toHaveLength(0)
  })

  it('queues a fresh build run on re-run build', async () => {
    const s = await inBuild()
    await f.work(s.id, 'builder', DONE)
    await decideOn(s.id, 're-run-build')
    expect(await f.view(s.id)).toMatchObject({ stage: 'build', waitingOn: 'agents', card: null })
    const claimed = await f.claimRun(s.id, 'builder')
    expect(claimed.run.stage).toBe('build')
  })

  it.each([
    ['without a covering reference', { alreadyDone: { evidence: 'it is there' } }, 'alreadyDone.by'],
    ['with a reference that is no number', { alreadyDone: { by: 'the other PR', evidence: 'x' } }, 'alreadyDone.by'],
    ['without evidence', { alreadyDone: { by: '#9' } }, 'alreadyDone.evidence'],
  ])('refuses an already-done result %s and names the fix', async (_name, result, path) => {
    const s = await inBuild()
    const refused = await f.work(s.id, 'builder', result)
    expect(refused).toMatchObject({ status: 'retry' })
    expect('problems' in refused && refused.problems.map((p) => p.path)).toEqual([path])
  })
})
