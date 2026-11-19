import { FakeBackend } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import { describe, expect, it } from 'vitest'
import { advance } from '../../src/core/engine'
import { DISCLOSURE } from '../../src/core/forge/disclosure'
import { createWriter } from '../../src/core/forge/writer'
import { remindReporters } from '../../src/core/intake/timing'
import { appendEvent, createRecord, readEvents, readRecord } from '../../src/core/record/store'
import { intakeHarness } from './intake-harness'
import { readerOf } from './mirror-harness'

const { h, deps, clock, product } = intakeHarness('core_reporter_remind')
const DAY = 86_400_000

const setup = async () => {
  const repo = h.fresh()
  const fake = new FakeBackend({ native: true, user: 'jo' })
  const issue = await fake.tickets(repo).create({ title: 'broken' })
  await h.settle({ [repo]: readerOf(fake) })
  const record = await createRecord(h.payload(), {
    workspace: h.ids.workspace,
    product: h.ids.product,
    source: { forge: 'github', repo, number: issue.number, reporter: 'jo', external: false, backlog: false },
    type: 'bug',
  })
  const writer = createWriter(h.payload(), { backend: async () => fake, now: () => clock.now })
  const ask = async (round: number) => {
    const event = await appendEvent(h.payload(), record.id, {
      type: 'intake.asked',
      data: { round },
      actor: 'agent',
    })
    await advance(record.id, deps())
    return Date.parse(event.createdAt)
  }
  const at = (askedMs: number, days: number) => void (clock.now = new Date(askedMs + days * DAY))
  const remind = () => remindReporters(deps(), writer)
  const types = async () => (await readEvents(h.payload(), record.id)).map((e) => e.type)
  const count = async (type: string) => (await types()).filter((t) => t === type).length
  const comments = () => fake.tickets(repo).listComments('1')
  return { record, ask, at, remind, types, count, comments }
}

describe('the reporter timing job', () => {
  it('stays quiet before 7 days', async () => {
    const s = await setup()
    const asked = await s.ask(1)
    s.at(asked, 6.9)
    await s.remind()
    expect(await s.count('reporter.reminded')).toBe(0)
    expect(await s.comments()).toEqual([])
  })

  it('sends one reminder comment at 7 days and not again in the same round', async () => {
    await product(sql`"state" = 'active'`)
    const s = await setup()
    const asked = await s.ask(1)
    s.at(asked, 7)
    await s.remind()
    await s.remind()
    s.at(asked, 10)
    await s.remind()
    expect(await s.count('reporter.reminded')).toBe(1)
    const comments = await s.comments()
    expect(comments).toHaveLength(1)
    expect(comments[0]?.body.startsWith(DISCLOSURE)).toBe(true)
    expect(await s.count('forge.write.done')).toBe(1)
  })

  it('reminds again in the next question round', async () => {
    await product(sql`"state" = 'active'`)
    const s = await setup()
    const first = await s.ask(1)
    s.at(first, 8)
    await s.remind()
    const second = await s.ask(2)
    s.at(second, 8)
    await s.remind()
    expect(await s.count('reporter.reminded')).toBe(2)
    expect(await s.comments()).toHaveLength(2)
  })

  it('records the silence at 21 days and the ticket moves on', async () => {
    const s = await setup()
    const asked = await s.ask(1)
    s.at(asked, 21)
    await s.remind()
    await s.remind()
    expect(await s.count('reporter.silent')).toBe(1)
    expect(await s.count('reporter.reminded')).toBe(0)
    expect(await readRecord(h.payload(), s.record.id)).toMatchObject({ waitingOn: 'agents' })
  })

  it('follows the Product settings', async () => {
    await product(sql`"reporter_remind_days" = 1, "reporter_silent_days" = 2`)
    const s = await setup()
    const asked = await s.ask(1)
    s.at(asked, 1)
    await s.remind()
    expect(await s.count('reporter.reminded')).toBe(1)
    s.at(asked, 2)
    await s.remind()
    expect(await s.count('reporter.silent')).toBe(1)
  })

  it('records the reminder but writes nothing to the forge for an observing Product', async () => {
    const s = await setup()
    const asked = await s.ask(1)
    s.at(asked, 7)
    await s.remind()
    expect(await s.count('reporter.reminded')).toBe(1)
    expect(await s.comments()).toEqual([])
    expect((await s.types()).some((t) => t.startsWith('forge.write.'))).toBe(false)
  })

  it('ignores a ticket that is not waiting on the reporter', async () => {
    await product(sql`"state" = 'active'`)
    const s = await setup()
    s.at(Date.now(), 30)
    await s.remind()
    expect(await s.count('reporter.reminded')).toBe(0)
    expect(await s.count('reporter.silent')).toBe(0)
  })
})
