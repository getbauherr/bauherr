import { sql } from '@payloadcms/db-postgres'
import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { Person } from '../../src/core/decide'
import { createWriter } from '../../src/core/forge/writer'
import { enterIssues } from '../../src/core/intake/enter'
import type { Who } from '../../src/core/memory'
import { appendEvent, readEvents, readRecord } from '../../src/core/record/store'
import { NotAllowedToChangeReadiness, ReadinessInvalid } from '../../src/core/readiness/errors'
import { refreshReadiness } from '../../src/core/readiness/refresh'
import { openReadinessTicket } from '../../src/core/readiness/ticket'
import { readiness } from '../../src/core/readiness/view'
import { holds } from '../../src/core/views/holds'
import { ticket } from '../../src/core/views/ticket'
import { readerOf } from './mirror-harness'
import { BRIEF, buildResult, flowHarness } from './modules-harness'

const f = flowHarness('core_readiness_flow')
const { h } = f

const MIN = 60_000
const after = (minutes: number) => new Date(Date.now() + minutes * MIN)
const owner = (): Person => ({ id: 'u7', role: 'bauherr', workspaceIds: [h.ids.workspace] })
const who = (): Who => ({ person: owner(), workspace: h.ids.workspace })
const writer = () => createWriter(h.payload(), { backend: async () => f.fake(), now: () => f.clock.now })
const filter = (now = new Date()) => ({ workspace: h.ids.workspace, product: h.ids.product, now })

const waitingForChecks = async () => {
  const s = await f.start('active')
  await f.work(s.id, 'builder', { outcome: 'accepted', type: 'bug', reason: 'clear' })
  await f.work(s.id, 'builder', BRIEF)
  const pull = await f.pullFor(s.repo, 'fix', 'a.txt')
  await f.work(s.id, 'builder', buildResult(pull.number, pull.headSha, 'p1'))
  await s.sync()
  return { ...s, pull }
}

beforeEach(() => h.rows(sql`DELETE FROM "instance_state" WHERE "key" LIKE 'readiness-tickets:%'`))

const backdate = (recordId: number) =>
  h.rows(sql`UPDATE "events" SET "created_at" = now() - interval '3 hours' WHERE "record_id" = ${recordId}`)

const checksHolds = async (now: Date) =>
  (await holds(h.payload(), { workspace: h.ids.workspace, now })).filter((hold) => hold.kind === 'checks-not-started')

describe('checks that never started on a pull request in Verify', () => {
  it('shows on the hold strip after an hour without a check run, and a check run clears it', async () => {
    const s = await waitingForChecks()
    expect(await checksHolds(after(30))).toEqual([])
    const [hold] = await checksHolds(after(61))
    expect(hold).toMatchObject({ kind: 'checks-not-started', recordId: s.id, number: 1 })
    expect(hold?.kind === 'checks-not-started' && hold.waitedMinutes).toBeGreaterThanOrEqual(60)
    f.green(s.repo, s.pull.headSha)
    await s.sync()
    expect(await checksHolds(after(61))).toEqual([])
  })

  it('holds nothing for a Product that requires no checks', async () => {
    await waitingForChecks()
    await f.product(sql`"required_checks" = NULL`)
    expect(await checksHolds(after(61))).toEqual([])
  })

  it('names the conflict of the pull request as the likely cause', async () => {
    const s = await waitingForChecks()
    await backdate(s.id)
    await h.rows(sql`UPDATE "mirror_items" SET "conflict_sha" = "head_sha", "base_ref" = 'main'
      WHERE "repo" = ${s.repo} AND "kind" = 'pr'`)
    const view = await ticket(h.payload(), { workspace: h.ids.workspace, recordId: s.id })
    expect(view.checksNotStarted?.cause).toBe('conflict')
    expect(view.checksNotStarted?.text).toContain('conflicts with main')
  })

  it('names missing CI when no recent pull request had a check, and a missing match when others did', async () => {
    const s = await waitingForChecks()
    await backdate(s.id)
    const none = await ticket(h.payload(), { workspace: h.ids.workspace, recordId: s.id })
    expect(none.checksNotStarted?.cause).toBe('ci-down')
    expect(none.checksNotStarted?.text).toContain('CI is down or missing')
    const other = await f.pullFor(s.repo, 'other', 'b.txt')
    f.green(s.repo, other.headSha)
    await s.sync()
    const some = await ticket(h.payload(), { workspace: h.ids.workspace, recordId: s.id })
    expect(some.checksNotStarted).toMatchObject({ cause: 'no-workflow', text: 'No workflow matched this change.' })
  })

  it('appears as the live line of the Product readiness and leaves a ticket page without the cause alone', async () => {
    const s = await waitingForChecks()
    const view = await readiness(h.payload(), filter(after(61)))
    expect(view?.items.find((item) => item.id === 'checks-not-started')).toMatchObject({
      status: 'gap',
      fix: { kind: 'link', href: `/tickets/${s.id}` },
    })
    const early = await ticket(h.payload(), { workspace: h.ids.workspace, recordId: s.id })
    expect(early.checksNotStarted).toBeNull()
  })
})

const openOf = async (repo: string) => (await f.fake().tickets(repo).list({ state: 'all' })).length

describe('opening a ticket for a gap', () => {
  const press = (check: 'agents-file' | 'issue-forms' | 'ci-runs' = 'agents-file') =>
    openReadinessTicket(h.payload(), who(), { product: h.ids.product, check, now: new Date() }, writer())

  it('opens one issue with the ask, keeps its number on the Product and shows the gap as open', async () => {
    const s = await f.start('active')
    const before = await openOf(s.repo)
    const number = await press()
    const issue = await f.fake().tickets(s.repo).get(String(number))
    expect(issue.title).toBe('Add an AGENTS.md with the build and test commands')
    expect(issue.body).toContain('No AGENTS.md. Agents learn the build and test commands')
    expect(issue.body).toContain('## The ask')
    expect(issue.body).toContain('Reference: bauherr-readiness-')
    expect(await openOf(s.repo)).toBe(before + 1)
    const item = (await readiness(h.payload(), filter()))?.items.find((entry) => entry.id === 'agents-file')
    expect(item).toMatchObject({ status: 'gap', ticket: { number, recordId: null } })
  })

  it('refuses a second press while the ticket is open and opens no second issue', async () => {
    const s = await f.start('active')
    const number = await press()
    const before = await openOf(s.repo)
    await expect(press()).rejects.toThrow(`Ticket #${number} is open for this gap`)
    expect(await openOf(s.repo)).toBe(before)
  })

  it('refuses a gap that is not one, an unknown person and an observing Product', async () => {
    const s = await f.start('active')
    await h.rows(sql`UPDATE "ticket_sources" SET "issue_form_count" = 2 WHERE "repo" = ${s.repo}`)
    await expect(press('issue-forms')).rejects.toThrow(ReadinessInvalid)
    const outsider: Who = { person: { ...owner(), role: 'product-owner' }, workspace: h.ids.workspace }
    const input = { product: h.ids.product, check: 'agents-file' as const, now: new Date() }
    await expect(openReadinessTicket(h.payload(), outsider, input, writer())).rejects.toThrow(
      NotAllowedToChangeReadiness,
    )
    await f.product(sql`"state" = 'observing'`)
    await expect(press()).rejects.toThrow(/observing: nothing is written to the forge/)
    expect(await openOf(s.repo)).toBe(1)
  })

  it('enters without Intake although a bot opened it, and its Brief goes to the owner', async () => {
    const s = await f.start('active')
    await f.work(s.id, 'builder', { outcome: 'not-planned', type: 'bug', reason: 'not now' })
    const number = await press()
    await s.sync()
    const entered = await enterIssues(f.subDeps())
    expect(entered).toHaveLength(1)
    const recordId = entered[0] ?? 0
    const stored = await readRecord(h.payload(), recordId)
    expect(stored.record.source).toMatchObject({ number, readiness: 'agents-file', external: false })
    const types = (await readEvents(h.payload(), recordId)).map((event) => event.type)
    expect(types.slice(0, 1)).toEqual(['intake.accepted'])
    await f.work(recordId, 'builder', BRIEF)
    expect((await f.view(recordId)).card).toMatchObject({ card: 'brief', reason: 'readiness' })
    const shown = await ticket(h.payload(), { workspace: h.ids.workspace, recordId })
    expect(shown.fromReadiness).toBe(h.ids.product)
    const item = (await readiness(h.payload(), filter()))?.items.find((entry) => entry.id === 'agents-file')
    expect(item?.ticket).toEqual({ number, recordId })
  })

  it('offers the button again after the ticket was closed and opens a second issue', async () => {
    const s = await f.start('active')
    const first = await press()
    await s.sync()
    const [recordId = 0] = await enterIssues(f.subDeps())
    await appendEvent(h.payload(), recordId, { type: 'ticket.closed', data: { reason: 'discarded' }, actor: 'owner' })
    const item = (await readiness(h.payload(), filter()))?.items.find((entry) => entry.id === 'agents-file')
    expect(item?.ticket).toBeNull()
    expect(await press()).not.toBe(first)
  })
})

describe('the daily check', () => {
  const count = z.object({ n: z.coerce.number() })

  it('is unknown before the facts are read, then stores them with the suggestions and the time', async () => {
    const s = await f.start('active')
    await h.rows(sql`UPDATE "ticket_sources" SET "facts_at" = NULL, "has_agents_file" = NULL
      WHERE "repo" = ${s.repo}`)
    const unknown = (await readiness(h.payload(), filter()))?.items.filter((item) => item.status === 'unknown')
    expect(unknown?.map((item) => item.id)).toEqual([
      'required-checks',
      'ci-runs',
      'agents-file',
      'issue-forms',
      'branch-protection',
    ])
    f.fake().commit(s.repo, 'main', 'src/auth/login.ts', 'x')
    const now = new Date('2026-11-24T08:00:00Z')
    const result = await refreshReadiness(h.payload(), { reader: async () => readerOf(f.fake()), now: () => now }, {
      workspace: h.ids.workspace,
      product: h.ids.product,
    })
    expect(result).toEqual({ checked: 1, errors: [] })
    const view = await readiness(h.payload(), filter())
    expect(view?.checkedAt).toBe(now.toISOString())
    expect(view?.items.find((item) => item.id === 'risk-areas')?.fix).toMatchObject({
      kind: 'setting',
      change: { setting: 'risk-areas', sets: [{ name: 'auth', paths: ['src/auth/**'] }] },
    })
    expect((await h.rows(sql`SELECT count(*) AS n FROM "ticket_sources"`)).map((row) => count.parse(row).n)[0]).toBe(1)
  })

  it('keeps the old facts and reports the error when the forge cannot be read', async () => {
    const s = await f.start('active')
    const before = (await readiness(h.payload(), filter()))?.checkedAt
    const failing = async () => {
      throw new Error('forge denied')
    }
    const result = await refreshReadiness(h.payload(), { reader: failing, now: () => new Date() }, {
      workspace: h.ids.workspace,
      product: h.ids.product,
    })
    expect(result.errors).toEqual([`${s.repo}: forge denied`])
    expect((await readiness(h.payload(), filter()))?.checkedAt).toBe(before)
  })
})
