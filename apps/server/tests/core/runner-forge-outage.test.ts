import { GithubError } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resumeParked } from '../../src/core/intake/pacing'
import { fold } from '../../src/core/fold'
import { foldOptions } from '../../src/core/lifecycle'
import { readEvents, readRecord } from '../../src/core/record/store'
import { lifecycleConfig } from '../../src/jobs/engine-deps'
import { runnerHarness } from './runner-harness'

const r = runnerHarness('core_runner_outage')
const { f } = r

const MIN = 60_000

beforeEach(async () => {
  await f.h.rows(sql`UPDATE "connections" SET "forge_limits" = NULL`)
})

const stateOf = async (recordId: number) =>
  fold(await readEvents(f.h.payload(), recordId), foldOptions(await lifecycleConfig(f.h.payload(), recordId)))

describe('a Runner run when the forge is down', () => {
  it('is released, not failed, and runs again once the forge answers', async () => {
    const s = await r.toBuild()
    const open = vi
      .spyOn(f.fake().forge, 'openPullRequest')
      .mockRejectedValueOnce(new GithubError(502, 'POST', '/pulls', 'Bad Gateway'))

    expect(await r.next()).toBe('released')
    expect(await r.events(s.id)).not.toContain('run.failed')
    expect((await stateOf(s.id)).failedRuns).toBe(0)
    expect((await readRecord(f.h.payload(), s.id)).parked).toMatch(/GitHub is not answering, retrying at/)
    expect(await r.next()).toBe('idle')

    f.clock.now = new Date(f.clock.now.getTime() + 3 * MIN)
    await resumeParked({ ...f.subDeps() }, null)
    expect(await r.next()).toBe('accepted')
    expect(open).toHaveBeenCalledTimes(2)
    expect((await stateOf(s.id)).failedRuns).toBe(0)
    expect(await f.h.rows(sql`SELECT 1 FROM "stage_runs" WHERE "status" = 'failed'`)).toHaveLength(0)
  })

  it('still fails a run on an error that is not the forge', async () => {
    const s = await r.toBuild()
    vi.spyOn(f.fake().forge, 'openPullRequest').mockRejectedValueOnce(new Error('the title is empty'))
    expect(await r.next()).toBe('failed')
    expect((await stateOf(s.id)).failedRuns).toBe(1)
  })
})
