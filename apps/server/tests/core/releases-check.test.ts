import { sql } from '@payloadcms/db-postgres'
import { describe, expect, it } from 'vitest'
import { refreshReadiness } from '../../src/core/readiness/refresh'
import { releasesPage } from '../../src/core/releases/view'
import { readerOf } from './mirror-harness'
import { flowHarness } from './modules-harness'

const f = flowHarness('core_releases_check')
const { h } = f

const refresh = (reader: () => Promise<ReturnType<typeof readerOf>>, now: Date) =>
  refreshReadiness(
    h.payload(),
    { reader, now: () => now },
    { workspace: h.ids.workspace, product: h.ids.product },
  )

const page = () => releasesPage(h.payload(), { workspace: h.ids.workspace, product: h.ids.product })

describe('releases page, last readiness check', () => {
  it('has no check and no releases for a repository that was never checked', async () => {
    await f.start('active')
    await h.rows(sql`UPDATE "ticket_sources" SET "facts_at" = NULL`)
    const view = await page()
    expect(view.ready).toBeNull()
    expect(view.check).toBeNull()
  })

  it('keeps the time and the error of a failed check, and clears the error when the next check works', async () => {
    await f.start('active')
    const failedAt = new Date('2026-11-26T08:00:00Z')
    const result = await refresh(() => Promise.reject(new Error('Bad credentials')), failedAt)
    expect(result.errors).toHaveLength(1)
    const failed = await page()
    expect(failed.ready).toBeNull()
    expect(failed.check?.at).toBe(failedAt.toISOString())
    expect(failed.check?.error).toContain('Bad credentials')
    const okAt = new Date('2026-11-26T09:00:00Z')
    expect((await refresh(async () => readerOf(f.fake()), okAt)).errors).toEqual([])
    const fine = await page()
    expect(fine.check).toEqual({ at: okAt.toISOString(), error: null })
    expect(fine.ready).not.toBeNull()
  })
})
