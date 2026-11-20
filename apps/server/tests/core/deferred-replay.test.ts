import { FakeBackend } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendDeferred } from '../../src/core/deferred'
import { runEffects } from '../../src/core/effects'
import type { AdvanceDeps } from '../../src/core/engine'
import { createWriter } from '../../src/core/forge/writer'
import { createRecord, readEvents } from '../../src/core/record/store'
import { LIVE_RUN_INDEX } from '../../src/migrations/20261119_140000_stage_runs'
import { CONFIG } from './fixtures'
import { mirrorHarness, readerOf } from './mirror-harness'

const h = mirrorHarness('core_deferred_replay')
const NOW = new Date('2026-11-19T12:00:00Z')

const setup = async () => {
  const repo = h.fresh()
  const fake = new FakeBackend({ native: true, user: 'jo' })
  const issues = [await fake.tickets(repo).create({ title: 'one' }), await fake.tickets(repo).create({ title: 'two' })]
  await h.sync({ [repo]: readerOf(fake) })
  const records = []
  for (const issue of issues) {
    records.push(
      await createRecord(h.payload(), {
        workspace: h.ids.workspace,
        product: h.ids.product,
        source: { forge: 'github', repo, number: issue.number, reporter: 'jo', external: false, backlog: false },
        type: 'bug',
      }),
    )
  }
  const forge = createWriter(h.payload(), { backend: async () => fake, now: () => NOW })
  const deps: AdvanceDeps = {
    payload: h.payload(),
    configFor: () => Promise.resolve(CONFIG),
    now: NOW,
    merge: () => Promise.reject(new Error('no merge')),
    forge,
  }
  return { fake, repo, issues, records, deps }
}

const state = (value: string) =>
  h.rows(sql`UPDATE "products" SET "state" = ${value} WHERE "id" = ${h.ids.product}`)

beforeAll(async () => {
  await h.payload().db.drizzle.execute(LIVE_RUN_INDEX)
})

beforeEach(async () => {
  await h.rows(sql`DELETE FROM "stage_runs"`)
  await h.rows(sql`DELETE FROM "events"`)
  await h.rows(sql`DELETE FROM "records"`)
  await state('observing')
})

describe('sendDeferred', () => {
  it('sends the others when one ticket fails, records the failure and retries only that one later', async () => {
    const s = await setup()
    for (const record of s.records) {
      await runEffects(s.deps, record.id, [{ kind: 'question', body: `why ${record.id}?` }])
    }
    await state('active')
    const tickets = s.fake.tickets(s.repo)
    const [one, two] = s.issues.map((issue) => issue.id)
    const comment = tickets.comment.bind(tickets)
    const failing = vi
      .spyOn(tickets, 'comment')
      .mockImplementation((id, body) => (id === one ? Promise.reject(new Error('forge down')) : comment(id, body)))
    await sendDeferred(s.deps, h.ids.product)
    expect(await tickets.listComments(one ?? '')).toEqual([])
    expect(await tickets.listComments(two ?? '')).toHaveLength(1)
    const events = await readEvents(h.payload(), s.records[0]?.id ?? 0)
    expect(events.map((e) => e.type).filter((type) => type.startsWith('forge.write.'))).toEqual([
      'forge.write.deferred',
      'forge.write.started',
      'forge.write.failed',
    ])
    failing.mockRestore()
    await sendDeferred(s.deps, h.ids.product)
    await sendDeferred(s.deps, h.ids.product)
    expect(await tickets.listComments(one ?? '')).toHaveLength(1)
    expect(await tickets.listComments(two ?? '')).toHaveLength(1)
  })

  it('sends nothing for a Product that is still observing', async () => {
    const s = await setup()
    await runEffects(s.deps, s.records[0]?.id ?? 0, [{ kind: 'question', body: 'why?' }])
    await sendDeferred(s.deps, h.ids.product)
    expect(await s.fake.tickets(s.repo).listComments(s.issues[0]?.id ?? '')).toEqual([])
  })
})
