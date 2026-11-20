import { FakeBackend } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import { describe, expect, it } from 'vitest'
import { enterIssues } from '../../src/core/intake/enter'
import { heldItems } from '../../src/core/intake/held'
import { readEvents, readRecord } from '../../src/core/record/store'
import { intakeHarness } from './intake-harness'
import { readerOf } from './mirror-harness'

const { h, deps, clock, product } = intakeHarness('core_intake_enter')

const forge = () =>
  new FakeBackend({ native: true, user: 'jo', users: ['jo', 'sam'], trusted: ['jo'], bots: ['robo'] })
const recordsOf = (repo: string) =>
  h.rows(sql`SELECT "id", "data" FROM "records" WHERE "source_repo" = ${repo} ORDER BY "source_number"`)
const typesOf = async (id: number) => (await readEvents(h.payload(), id)).map((e) => e.type)

type Issue = { title?: string; author?: string; labels?: string[] }

const open = async (repo: string, fake: FakeBackend, issues: Issue[]) => {
  for (const issue of issues) await fake.tickets(repo).create({ title: 'x', ...issue })
  await h.settle({ [repo]: readerOf(fake) })
}

describe('entering issues', () => {
  it('gives an issue of a trusted author one record, however often it runs', async () => {
    const repo = h.fresh()
    await open(repo, forge(), [{ title: 'broken' }])
    expect(await enterIssues(deps())).toHaveLength(1)
    expect(await enterIssues(deps())).toEqual([])
    await enterIssues(deps())
    const [row] = await recordsOf(repo)
    expect(await recordsOf(repo)).toHaveLength(1)
    expect(row?.data).toMatchObject({ source: { repo, number: 1, reporter: 'jo', external: false, backlog: false } })
    const stored = await readRecord(h.payload(), Number(row?.id))
    expect(stored).toMatchObject({ stage: 'intake', waitingOn: 'agents' })
    expect((await typesOf(stored.id)).filter((t) => t === 'run.started')).toHaveLength(1)
  })

  it('creates no record for an issue that select skips', async () => {
    const repo = h.fresh()
    const fake = forge()
    await open(repo, fake, [
      { title: 'by a bot', author: 'robo' },
      { title: 'excluded', labels: ['wontfix'] },
      { title: 'assigned' },
      { title: 'closed' },
    ])
    await product(sql`"intake_excluded_labels" = '["wontfix"]'::jsonb`)
    await fake.tickets(repo).claim('3', 'sam')
    await fake.tickets(repo).close('4', 'completed')
    await h.sync({ [repo]: readerOf(fake) })
    expect(await enterIssues(deps())).toEqual([])
    expect(await recordsOf(repo)).toHaveLength(0)
    expect(await heldItems(h.payload(), h.ids.product, clock.now)).toEqual([])
  })

  it('marks an issue older than the connection as backlog and an outside author as external', async () => {
    const repo = h.fresh()
    const fake = new FakeBackend({ native: true, user: 'jo', trusted: ['jo'] })
    await open(repo, fake, [{ title: 'old' }, { title: 'outside', author: 'eve', labels: ['bauherr:intake'] }])
    await product(sql`"connected_at" = '2026-06-01T00:00:00Z'::timestamptz`)
    await enterIssues(deps())
    const rows = await recordsOf(repo)
    expect(rows.map((r) => r.data)).toMatchObject([
      { source: { reporter: 'jo', external: false, backlog: true } },
      { source: { reporter: 'eve', external: true, backlog: true } },
    ])
  })

  it('holds an outside author without the label: no record, listed with the reason', async () => {
    const repo = h.fresh()
    const fake = new FakeBackend({ native: true, user: 'jo', trusted: ['jo'] })
    await open(repo, fake, [{ title: 'help', author: 'eve' }])
    expect(await enterIssues(deps())).toEqual([])
    expect(await recordsOf(repo)).toHaveLength(0)
    expect(await heldItems(h.payload(), h.ids.product, clock.now)).toMatchObject([
      { repo, number: 1, title: 'help', author: 'eve', reason: 'outside-author' },
    ])
  })

  it('admits the issue once the intake label is added and drops it from the held list', async () => {
    const repo = h.fresh()
    const fake = new FakeBackend({ native: true, user: 'jo', trusted: ['jo'] })
    await open(repo, fake, [{ title: 'help', author: 'eve' }])
    await enterIssues(deps())
    await fake.tickets(repo).addLabels('1', ['bauherr:intake'])
    await h.sync({ [repo]: readerOf(fake) })
    expect(await enterIssues(deps())).toHaveLength(1)
    expect(await heldItems(h.payload(), h.ids.product, clock.now)).toEqual([])
  })

  it('admits at most the daily budget per outside author and holds the rest as over budget', async () => {
    const repo = h.fresh()
    const fake = new FakeBackend({ native: true, user: 'jo', trusted: ['jo'] })
    const mine = { author: 'eve', labels: ['bauherr:intake'] }
    await open(repo, fake, [
      { title: 'a', ...mine },
      { title: 'b', ...mine },
      { title: 'c', ...mine },
      { title: 'd', author: 'max', labels: ['bauherr:intake'] },
    ])
    await product(sql`"outside_issues_per_day" = 2`)
    expect(await enterIssues(deps())).toHaveLength(3)
    expect(await enterIssues(deps())).toEqual([])
    const held = await heldItems(h.payload(), h.ids.product, clock.now)
    expect(held).toMatchObject([{ number: 3, author: 'eve', reason: 'budget' }])
    expect((await recordsOf(repo)).map((r) => r.id)).toHaveLength(3)
  })

  it('counts only the last 24 hours against the budget', async () => {
    const repo = h.fresh()
    const fake = new FakeBackend({ native: true, user: 'jo', trusted: ['jo'] })
    const mine = { author: 'eve', labels: ['bauherr:intake'] }
    await open(repo, fake, [{ title: 'a', ...mine }, { title: 'b', ...mine }])
    await product(sql`"outside_issues_per_day" = 1`)
    expect(await enterIssues(deps())).toHaveLength(1)
    clock.now = new Date(Date.now() + 25 * 3_600_000)
    expect(await enterIssues(deps())).toHaveLength(1)
  })

  it('writes nothing to the forge for an observing Product', async () => {
    const repo = h.fresh()
    const fake = forge()
    await open(repo, fake, [{ title: 'broken' }])
    await enterIssues(deps())
    const [row] = await recordsOf(repo)
    const types = await typesOf(Number(row?.id))
    expect(types.some((t) => t.startsWith('forge.write.'))).toBe(false)
    const issue = await fake.tickets(repo).get('1')
    expect(issue.labels).toEqual([])
    expect(await fake.tickets(repo).listComments('1')).toEqual([])
  })

  it('does not enter when the sync reports the same issues again', async () => {
    const repo = h.fresh()
    const fake = forge()
    await open(repo, fake, [{ title: 'broken' }])
    const seen: number[][] = []
    const hook = async (_source: unknown, ids: number[]) => {
      seen.push(ids)
      await enterIssues(deps())
    }
    await h.sync({ [repo]: readerOf(fake) }, hook)
    await h.sync({ [repo]: readerOf(fake) }, hook)
    expect(await recordsOf(repo)).toHaveLength(1)
    expect(seen[1]).toEqual([])
  })
})
