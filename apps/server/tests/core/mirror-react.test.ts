import { FakeBackend } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import { describe, expect, it } from 'vitest'
import { DISCLOSURE } from '../../src/core/forge/disclosure'
import { reactToOpenRecords } from '../../src/core/mirror/react-run'
import { appendEvent, createRecord, readEvents, readRecord, type NewEvent } from '../../src/core/record/store'
import { intakeHarness } from './intake-harness'
import { HOUR, readerOf } from './mirror-harness'

const { h, deps, reacting, product } = intakeHarness('core_mirror_react')

const setup = async () => {
  const repo = h.fresh()
  const fake = new FakeBackend({ native: true, user: 'jo', users: ['jo', 'eve'] })
  const issue = await fake.tickets(repo).create({ title: 'broken' })
  const readers = { [repo]: readerOf(fake) }
  await h.settle(readers)
  const record = await createRecord(h.payload(), {
    workspace: h.ids.workspace,
    product: h.ids.product,
    source: { forge: 'github', repo, number: issue.number, reporter: 'jo', external: false, backlog: false },
    type: 'bug',
  })
  const append = (event: Omit<NewEvent, 'actor'>) =>
    appendEvent(h.payload(), record.id, { ...event, actor: 'factory' } as NewEvent)
  const sync = () => h.sync(readers, reacting)
  const types = async () => (await readEvents(h.payload(), record.id)).map((e) => e.type)
  const count = async (type: string) => (await types()).filter((t) => t === type).length
  return { repo, fake, issue, record, append, sync, types, count }
}

type Setup = Awaited<ReturnType<typeof setup>>

const asked = async (s: Setup) => {
  const event = await s.append({ type: 'intake.asked', data: { round: 1 } })
  const target = { repo: s.repo, number: 1 }
  const posted = await s.append({ type: 'forge.write.done', data: { kind: 'question', target } })
  await h.rows(sql`UPDATE "events" SET "created_at" = '2025-12-01T00:00:00Z' WHERE "id" IN (${event.id}, ${posted.id})`)
}

const stageIs = (s: Setup, stage: string) =>
  h.rows(sql`UPDATE "records" SET "stage" = ${stage} WHERE "id" = ${s.record.id}`)

const toBuilt = async (s: Setup, headSha: string, pr: number) => {
  await s.append({ type: 'intake.accepted', data: {} })
  await s.append({ type: 'brief.submitted', data: { runId: '1' } })
  await s.append({ type: 'brief.approved', data: { by: 'rule' } })
  await s.append({ type: 'build.submitted', data: { runId: '2', patchId: 'p1', headSha, pr } })
  await stageIs(s, 'verify')
}

const openPull = async (s: Setup) => {
  await s.fake.forge.createBranch(s.repo, 'fix')
  const headSha = s.fake.commit(s.repo, 'fix', 'a.txt', 'x')
  const pull = await s.fake.forge.openPullRequest(s.repo, { title: 'p', head: 'fix', base: 'main' })
  return { headSha, number: pull.number }
}

const running = { name: 'ci', status: 'in_progress', conclusion: null }
const finished = (conclusion: string) => ({ name: 'ci', status: 'completed', conclusion })

describe('the reporter replied', () => {
  it('appends reporter.replied once for a comment of the reporter after the question', async () => {
    const s = await setup()
    await asked(s)
    await s.sync()
    s.fake.actingAs = 'eve'
    await s.fake.tickets(s.repo).comment('1', 'me too')
    s.fake.actingAs = 'jo'
    await s.fake.tickets(s.repo).comment('1', `${DISCLOSURE}\n\nstatus`)
    await s.sync()
    expect(await s.count('reporter.replied')).toBe(0)
    await s.fake.tickets(s.repo).comment('1', 'the answer is yes')
    await s.sync()
    await s.sync()
    await s.sync()
    expect(await s.count('reporter.replied')).toBe(1)
    const events = await readEvents(h.payload(), s.record.id)
    expect(events.find((e) => e.type === 'reporter.replied')?.actor).toBe('reporter')
    expect((await readRecord(h.payload(), s.record.id)).stage).toBe('intake')
  })

  it('writes nothing to the forge for an observing Product', async () => {
    const s = await setup()
    await asked(s)
    s.fake.actingAs = 'jo'
    await s.fake.tickets(s.repo).comment('1', 'answer')
    await s.sync()
    expect(await s.count('reporter.replied')).toBe(1)
    expect(await s.count('forge.write.started')).toBe(0)
    expect(await s.fake.tickets(s.repo).listComments('1')).toHaveLength(1)
  })
})

describe('the checks finished', () => {
  it('appends checks.finished once, passed, when every check of the head succeeded', async () => {
    await product(sql`"required_checks" = 'ci'`)
    const s = await setup()
    const pull = await openPull(s)
    await toBuilt(s, pull.headSha, pull.number)
    s.fake.setChecks(s.repo, pull.headSha, [running])
    await s.sync()
    expect(await s.count('checks.finished')).toBe(0)
    s.fake.setChecks(s.repo, pull.headSha, [finished('success')])
    await s.sync()
    await s.sync()
    await s.sync()
    expect(await s.count('checks.finished')).toBe(1)
    const events = await readEvents(h.payload(), s.record.id)
    expect(events.find((e) => e.type === 'checks.finished')?.data).toEqual({ patchId: 'p1', passed: true })
    expect(await s.count('run.started')).toBe(1)
  })

  it('waits for a required check that has not reported, even when the reported ones passed', async () => {
    await product(sql`"required_checks" = 'ci, e2e'`)
    const s = await setup()
    const pull = await openPull(s)
    await toBuilt(s, pull.headSha, pull.number)
    s.fake.setChecks(s.repo, pull.headSha, [finished('success')])
    await s.sync()
    await s.sync()
    expect(await s.count('checks.finished')).toBe(0)
    s.fake.setChecks(s.repo, pull.headSha, [finished('success'), { ...finished('success'), name: 'e2e' }])
    await s.sync()
    await s.sync()
    await s.sync()
    expect(await s.count('checks.finished')).toBe(1)
  })

  it('appends passed false for a failed check', async () => {
    await product(sql`"required_checks" = 'ci'`)
    const s = await setup()
    const pull = await openPull(s)
    await toBuilt(s, pull.headSha, pull.number)
    s.fake.setChecks(s.repo, pull.headSha, [finished('failure')])
    await s.sync()
    const events = await readEvents(h.payload(), s.record.id)
    expect(events.find((e) => e.type === 'checks.finished')?.data).toEqual({ patchId: 'p1', passed: false })
  })

  it('is found by the sweep when the checks finished before the patch was recorded', async () => {
    await product(sql`"required_checks" = 'ci'`)
    const s = await setup()
    const pull = await openPull(s)
    s.fake.setChecks(s.repo, pull.headSha, [finished('success')])
    await s.sync()
    await toBuilt(s, pull.headSha, pull.number)
    await s.sync()
    expect(await s.count('checks.finished')).toBe(0)
    await reactToOpenRecords(deps())
    await reactToOpenRecords(deps())
    expect(await s.count('checks.finished')).toBe(1)
  })

  it('has no pending checks, and so no event, when the Product requires none', async () => {
    const s = await setup()
    const pull = await openPull(s)
    await toBuilt(s, pull.headSha, pull.number)
    s.fake.setChecks(s.repo, pull.headSha, [finished('success')])
    await s.sync()
    expect(await s.count('checks.finished')).toBe(0)
  })
})

describe('the pull request merged', () => {
  it('appends ship.merged once with the merge commit when the sync sees the merge', async () => {
    const s = await setup()
    const pull = await openPull(s)
    await toBuilt(s, pull.headSha, pull.number)
    await s.append({ type: 'checks.finished', data: { patchId: 'p1', passed: true } })
    await s.append({ type: 'verify.passed', data: { runId: '3', patchId: 'p1', headSha: pull.headSha } })
    await stageIs(s, 'ship')
    await s.sync()
    const sha = s.fake.merge(s.repo, pull.number)
    h.later(25 * HOUR)
    await s.sync()
    await s.sync()
    h.later(25 * HOUR)
    await s.sync()
    expect(await s.count('ship.merged')).toBe(1)
    const events = await readEvents(h.payload(), s.record.id)
    expect(events.find((e) => e.type === 'ship.merged')?.data).toEqual({ sha })
  })
})

describe('the issue was closed on the forge', () => {
  it('appends ticket.closed with closed-on-forge once and ends the ticket', async () => {
    const s = await setup()
    await s.fake.tickets(s.repo).close('1', 'completed')
    await s.sync()
    await s.sync()
    await s.sync()
    expect(await s.count('ticket.closed')).toBe(1)
    const events = await readEvents(h.payload(), s.record.id)
    expect(events.find((e) => e.type === 'ticket.closed')?.data).toEqual({ reason: 'closed-on-forge' })
    expect(await readRecord(h.payload(), s.record.id)).toMatchObject({ waitingOn: 'nobody' })
  })

  it('does not close a ticket the factory closed itself', async () => {
    const s = await setup()
    await s.append({ type: 'intake.closed', data: { reason: 'duplicate' } })
    await s.fake.tickets(s.repo).close('1', 'duplicate')
    await s.sync()
    expect(await s.count('ticket.closed')).toBe(0)
  })
})
