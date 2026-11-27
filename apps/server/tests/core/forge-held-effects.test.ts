import { FakeBackend, GithubError } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sendHeld } from '../../src/core/deferred'
import { runEffects } from '../../src/core/effects'
import type { AdvanceDeps } from '../../src/core/engine'
import { createWriter } from '../../src/core/forge/writer'
import { createRecord, readEvents } from '../../src/core/record/store'
import { CONFIG } from './fixtures'
import { mirrorHarness, readerOf } from './mirror-harness'

const h = mirrorHarness('core_forge_held_effects')
const NOW = new Date('2026-11-19T12:00:00Z')
const LATER = new Date(NOW.getTime() + 3 * 60_000)

const setup = async () => {
  const repo = h.fresh()
  const fake = new FakeBackend({ native: true, user: 'jo' })
  const issue = await fake.tickets(repo).create({ title: 'one' })
  await h.sync({ [repo]: readerOf(fake) })
  const record = await createRecord(h.payload(), {
    workspace: h.ids.workspace,
    product: h.ids.product,
    source: { forge: 'github', repo, number: issue.number, reporter: 'jo', external: false, backlog: false },
    type: 'bug',
  })
  const deps = (now: Date): AdvanceDeps => ({
    payload: h.payload(),
    configFor: () => Promise.resolve(CONFIG),
    now,
    merge: () => Promise.reject(new Error('no merge')),
    forge: createWriter(h.payload(), { backend: async () => fake, now: () => now }),
  })
  return { fake, repo, record, deps }
}

const forgeEvents = async (id: number) =>
  (await readEvents(h.payload(), id)).map((e) => e.type).filter((type) => type.startsWith('forge.write.'))

beforeEach(async () => {
  await h.rows(sql`UPDATE "connections" SET "forge_limits" = NULL`)
  await h.rows(sql`DELETE FROM "events"`)
  await h.rows(sql`DELETE FROM "records"`)
  await h.rows(sql`UPDATE "products" SET "state" = 'active' WHERE "id" = ${h.ids.product}`)
})

describe('forge effects during a forge outage', () => {
  it('keeps the question, does not queue it twice and sends it once after the hold', async () => {
    const s = await setup()
    const tickets = s.fake.tickets(s.repo)
    const comment = vi
      .spyOn(tickets, 'comment')
      .mockRejectedValue(new GithubError(502, 'POST', '/comments', 'Bad Gateway'))
    const effect = { kind: 'question' as const, body: 'why?' }

    await runEffects(s.deps(NOW), s.record.id, [effect])
    await runEffects(s.deps(NOW), s.record.id, [effect])
    expect((await forgeEvents(s.record.id)).filter((type) => type === 'forge.write.deferred')).toHaveLength(1)

    const calls = comment.mock.calls.length
    await sendHeld(s.deps(NOW))
    expect(comment).toHaveBeenCalledTimes(calls)

    comment.mockRestore()
    await sendHeld(s.deps(LATER))
    await sendHeld(s.deps(LATER))
    expect(await tickets.listComments('1')).toHaveLength(1)
    expect(await forgeEvents(s.record.id)).toContain('forge.write.done')
  })

  it('does not queue a write that failed for another reason', async () => {
    const s = await setup()
    vi.spyOn(s.fake.tickets(s.repo), 'comment').mockRejectedValueOnce(new Error('the body is empty'))
    await runEffects(s.deps(NOW), s.record.id, [{ kind: 'question', body: 'why?' }])
    expect(await forgeEvents(s.record.id)).not.toContain('forge.write.deferred')
  })

  it('keeps a reopen through an outage and sends it after the hold', async () => {
    const s = await setup()
    const tickets = s.fake.tickets(s.repo)
    await tickets.close('1', 'completed')
    const reopen = vi
      .spyOn(tickets, 'reopen')
      .mockRejectedValue(new GithubError(502, 'POST', '/issues/1', 'Bad Gateway'))

    await runEffects(s.deps(NOW), s.record.id, [{ kind: 'reopen' }])
    expect((await readEvents(h.payload(), s.record.id)).map((e) => e.data)).toContainEqual(
      expect.objectContaining({ kind: 'reopen' }),
    )

    reopen.mockRestore()
    await sendHeld(s.deps(LATER))
    expect((await tickets.get('1')).state).toBe('open')
  })

  it('defers a status comment at once while the Connection is held, without calling the forge', async () => {
    const s = await setup()
    const comment = vi.spyOn(s.fake.tickets(s.repo), 'comment')
    const until = new Date(NOW.getTime() + 60_000).toISOString()
    const limits = JSON.stringify({ pausedUntil: until, pauseReason: 'outage' })
    await h.rows(sql`UPDATE "connections" SET "forge_limits" = ${limits}::jsonb`)

    await runEffects(s.deps(NOW), s.record.id, [{ kind: 'status' }, { kind: 'status' }])
    expect(comment).not.toHaveBeenCalled()
    expect((await forgeEvents(s.record.id)).filter((type) => type === 'forge.write.deferred')).toHaveLength(1)

    await sendHeld(s.deps(LATER))
    expect(comment).toHaveBeenCalledOnce()
  })

  it.each([
    ['close', 'reopen', 'closed'],
    ['reopen', 'close', 'open'],
  ] as const)('ends %s, %s, %s in the last state after the hold', async (first, second, final) => {
    const s = await setup()
    const tickets = s.fake.tickets(s.repo)
    if (first === 'reopen') await tickets.close('1', 'completed')
    const down = new GithubError(502, 'POST', '/issues/1', 'Bad Gateway')
    vi.spyOn(tickets, 'close').mockRejectedValue(down)
    vi.spyOn(tickets, 'reopen').mockRejectedValue(down)
    const effect = (kind: 'close' | 'reopen') =>
      kind === 'close' ? { kind: 'close' as const, reason: 'completed' as const } : { kind: 'reopen' as const }

    await runEffects(s.deps(NOW), s.record.id, [effect(first)])
    await runEffects(s.deps(NOW), s.record.id, [effect(second)])
    await runEffects(s.deps(NOW), s.record.id, [effect(first)])
    vi.restoreAllMocks()

    await sendHeld(s.deps(LATER))
    await sendHeld(s.deps(LATER))
    expect((await tickets.get('1')).state).toBe(final === 'closed' ? 'closed' : 'open')
  })
})
