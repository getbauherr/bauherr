import { FakeBackend } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import { beforeEach, describe, expect, it } from 'vitest'
import { DISCLOSURE } from '../../src/core/forge/disclosure'
import { runEffects } from '../../src/core/effects'
import type { AdvanceDeps } from '../../src/core/engine'
import { createWriter } from '../../src/core/forge/writer'
import { createRecord, readEvents } from '../../src/core/record/store'
import { CONFIG } from './fixtures'
import { mirrorHarness, readerOf } from './mirror-harness'

const h = mirrorHarness('core_effects')
const NOW = new Date('2026-11-19T12:00:00Z')

const setup = async (backend?: () => Promise<FakeBackend>) => {
  const repo = h.fresh()
  const fake = new FakeBackend({ native: true, user: 'jo' })
  const issue = await fake.tickets(repo).create({ title: 'broken', labels: ['bug'] })
  await h.sync({ [repo]: readerOf(fake) })
  const record = await createRecord(h.payload(), {
    workspace: h.ids.workspace,
    product: h.ids.product,
    source: { forge: 'github', repo, number: issue.number, reporter: 'jo', external: false, backlog: false },
    type: 'bug',
  })
  const forge = createWriter(h.payload(), { backend: backend ?? (async () => fake), now: () => NOW })
  const deps: AdvanceDeps = {
    payload: h.payload(),
    configFor: () => Promise.resolve(CONFIG),
    now: NOW,
    merge: () => Promise.reject(new Error('no merge')),
    forge,
  }
  return { fake, repo, issue, record, deps }
}

const active = (state: string) =>
  h.rows(sql`UPDATE "products" SET "state" = ${state} WHERE "id" = ${h.ids.product}`)
const types = async (recordId: number) => (await readEvents(h.payload(), recordId)).map((e) => e.type)

beforeEach(async () => {
  await h.rows(sql`DELETE FROM "events"`)
  await h.rows(sql`DELETE FROM "records"`)
  await active('active')
})

const comments = async (s: Awaited<ReturnType<typeof setup>>) =>
  s.fake.tickets(s.repo).listComments(s.issue.id)

describe('runEffects', () => {
  it('posts a question, edits the status comment in place, and closes', async () => {
    const s = await setup()
    await runEffects(s.deps, s.record.id, [{ kind: 'question', body: '1. Which browser?' }])
    expect((await comments(s)).map((c) => c.body)).toEqual([`${DISCLOSURE}\n\n1. Which browser?`])
    await runEffects(s.deps, s.record.id, [{ kind: 'status' }])
    await runEffects(s.deps, s.record.id, [{ kind: 'status' }])
    const bodies = (await comments(s)).map((c) => c.body)
    expect(bodies).toHaveLength(2)
    expect(bodies[1]).toContain('**Stage:** **intake** › brief')
    await runEffects(s.deps, s.record.id, [{ kind: 'close', reason: 'not_planned' }])
    expect((await s.fake.tickets(s.repo).get(s.issue.id)).state).toBe('closed')
  })

  it('records the refusal of an observing Product once per effect and writes nothing', async () => {
    const s = await setup()
    await active('observing')
    await runEffects(s.deps, s.record.id, [{ kind: 'question', body: 'why?' }, { kind: 'status' }])
    expect(await types(s.record.id)).toEqual(['forge.write.failed', 'forge.write.failed'])
    expect(await comments(s)).toEqual([])
  })

  it('does not throw when the forge fails, and the writer records the failure once', async () => {
    const s = await setup(() => Promise.reject(new Error('forge down')))
    await expect(runEffects(s.deps, s.record.id, [{ kind: 'question', body: 'why?' }])).resolves.toBeUndefined()
    expect(await types(s.record.id)).toEqual([])
  })

  it('does nothing without a forge port', async () => {
    const s = await setup()
    await runEffects({ ...s.deps, forge: undefined }, s.record.id, [{ kind: 'status' }])
    expect(await types(s.record.id)).toEqual([])
  })
})
