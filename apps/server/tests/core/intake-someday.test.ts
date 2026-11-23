import { FakeBackend } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import { describe, expect, it } from 'vitest'
import { enterIssues } from '../../src/core/intake/enter'
import { heldItems } from '../../src/core/intake/held'
import { intakeHarness } from './intake-harness'
import { readerOf } from './mirror-harness'

const { h, deps, clock, product } = intakeHarness('core_intake_someday')

const LABEL = 'bauherr:someday'
const recordsOf = (repo: string) => h.rows(sql`SELECT "id" FROM "records" WHERE "source_repo" = ${repo}`)
const runsOf = () => h.rows(sql`SELECT "id" FROM "stage_runs"`)
const forge = () => new FakeBackend({ native: true, user: 'jo', users: ['jo'], trusted: ['jo'] })

describe('Someday label', () => {
  it('is excluded from Intake by default: no record, no run, no Inbox item', async () => {
    await product(sql`"intake_excluded_labels" = DEFAULT`)
    const repo = h.fresh()
    const fake = forge()
    await fake.tickets(repo).create({ title: 'idea', labels: [LABEL] })
    await h.settle({ [repo]: readerOf(fake) })
    expect(await enterIssues(deps())).toEqual([])
    expect(await recordsOf(repo)).toHaveLength(0)
    expect(await runsOf()).toHaveLength(0)
    expect(await heldItems(h.payload(), h.ids.product, clock.now)).toEqual([])
  })

  it('takes the issue into Intake once after the label is removed', async () => {
    await product(sql`"intake_excluded_labels" = DEFAULT`)
    const repo = h.fresh()
    const fake = forge()
    await fake.tickets(repo).create({ title: 'idea', labels: [LABEL] })
    await h.settle({ [repo]: readerOf(fake) })
    await enterIssues(deps())
    await fake.tickets(repo).removeLabels('1', [LABEL])
    await h.sync({ [repo]: readerOf(fake) })
    expect(await enterIssues(deps())).toHaveLength(1)
    expect(await enterIssues(deps())).toEqual([])
    expect(await recordsOf(repo)).toHaveLength(1)
  })

  it('leaves an already entered Ticket alone when the label is added later', async () => {
    await product(sql`"intake_excluded_labels" = DEFAULT`)
    const repo = h.fresh()
    const fake = forge()
    await fake.tickets(repo).create({ title: 'work' })
    await h.settle({ [repo]: readerOf(fake) })
    await enterIssues(deps())
    await fake.tickets(repo).addLabels('1', [LABEL])
    await h.sync({ [repo]: readerOf(fake) })
    await enterIssues(deps())
    expect(await recordsOf(repo)).toHaveLength(1)
  })
})
