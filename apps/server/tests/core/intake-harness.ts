import { sql } from '@payloadcms/db-postgres'
import { beforeAll, beforeEach } from 'vitest'
import type { AdvanceDeps } from '../../src/core/engine'
import { pacing } from '../../src/core/intake/pacing'
import { reactToItems } from '../../src/core/mirror/react-run'
import { LIVE_RUN_INDEX } from '../../src/migrations/20261119_140000_stage_runs'
import { lifecycleConfig } from '../../src/jobs/engine-deps'
import { START, mirrorHarness } from './mirror-harness'

export const intakeHarness = (suite: string) => {
  const h = mirrorHarness(suite)
  const clock = { now: START }

  const deps = (): AdvanceDeps => ({
    payload: h.payload(),
    configFor: (recordId) => lifecycleConfig(h.payload(), recordId),
    now: clock.now,
    merge: () => Promise.reject(new Error('no merge in this test')),
    mayStart: pacing(h.payload()),
  })

  const reacting = (_source: unknown, itemIds: number[]) => reactToItems(deps(), itemIds)

  const product = (fields: ReturnType<typeof sql>) =>
    h.rows(sql`UPDATE "products" SET ${fields} WHERE "id" = ${h.ids.product}`)

  beforeAll(async () => {
    await h.payload().db.drizzle.execute(LIVE_RUN_INDEX)
  })

  beforeEach(async () => {
    await h.rows(sql`DELETE FROM "events"`)
    await h.rows(sql`DELETE FROM "proofs"`)
    await h.rows(sql`DELETE FROM "stage_runs"`)
    await h.rows(sql`DELETE FROM "records"`)
    clock.now = START
    await product(sql`"state" = 'observing', "connected_at" = NULL, "intake_excluded_labels" = '[]'::jsonb,
      "outside_issues_per_day" = 5, "backlog_brief_limit" = 5, "required_checks" = NULL, "auto_close" = true,
      "reporter_remind_days" = 7, "reporter_silent_days" = 21`)
  })

  return { h, clock, deps, reacting, product }
}
