import { sql } from '@payloadcms/db-postgres'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { refreshReadiness } from '../../src/core/readiness/refresh'
import { readerOf } from './mirror-harness'
import { releaseHarness } from './release-harness'

const { f, h, setup, releaser, start, deployed, NOW } = releaseHarness('core_forge_hold_tasks')

const HOUR = 3_600_000

const holdUntil = (at: Date | null) =>
  h.rows(sql`UPDATE "connections" SET "forge_limits" = ${JSON.stringify(
    at === null ? {} : { pausedUntil: at.toISOString(), pauseReason: 'rate-limit' },
  )}::jsonb WHERE "id" = ${h.ids.connection}`)

beforeEach(() => holdUntil(null))

describe('scheduled tasks while a Connection is held by the forge', () => {
  it('advance-releases leaves a running release alone until the hold ends', async () => {
    const s = await setup()
    const r = releaser()
    await start(r)
    deployed(s)
    await holdUntil(new Date(NOW.getTime() + HOUR))

    expect(await r.advanceRunning()).toBe(0)
    expect(await h.rows(sql`SELECT "state" FROM "product_releases"`)).toEqual([{ state: 'running' }])
  })

  it('advance-releases advances it once there is no hold', async () => {
    const s = await setup()
    const r = releaser()
    const first = await start(r)
    deployed(s)
    await holdUntil(new Date(NOW.getTime() - HOUR))

    expect(await r.advanceRunning()).toBe(1)
    expect((await r.advance(first.id))?.state).toBe('done')
  })

  it('check-readiness skips a held Connection and checks it after the hold', async () => {
    await setup()
    const reader = vi.fn(async () => readerOf(f.fake()))
    const deps = { reader, now: () => NOW }
    await holdUntil(new Date(NOW.getTime() + HOUR))
    expect(await refreshReadiness(h.payload(), deps, null)).toEqual({ checked: 0, errors: [] })
    expect(reader).not.toHaveBeenCalled()

    await holdUntil(null)
    expect((await refreshReadiness(h.payload(), deps, null)).checked).toBe(1)
    expect(reader).toHaveBeenCalled()
  })
})
