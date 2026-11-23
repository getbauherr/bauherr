import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { advance } from '../../src/core/engine'
import { appendEvent } from '../../src/core/record/store'
import { RecordNotFound } from '../../src/core/record/errors'
import { firstLook } from '../../src/core/views/first-look'
import { holds } from '../../src/core/views/holds'
import { RunNotFound } from '../../src/core/run/errors'
import { runPage } from '../../src/core/views/run'
import { ticket } from '../../src/core/views/ticket'
import { openViews, seed, type Seeded } from './views-harness'

let s: Seeded
const MIN = 60_000
const QUERIES = 7
const DAY = 86_400_000
const run = (query: ReturnType<typeof sql>) => s.e.db.payload.db.drizzle.execute(query)
const session = (role: string, lastSeen: Date, disconnected = false) =>
  run(sql`INSERT INTO "agent_sessions" ("workspace_id", "public_id", "role", "connected_at", "last_seen_at",
    "disconnected_at") VALUES (${s.e.db.workspace}, ${`s-${Math.random()}`}, ${role}, now(),
    ${lastSeen.toISOString()}::timestamptz, ${disconnected ? new Date().toISOString() : null}::timestamptz)`)

beforeAll(async () => {
  s = await seed(await openViews('core_views_misc'))
}, 240_000)
afterAll(async () => {
  await s?.e.drop()
})

describe('holds', () => {
  const find = async (now = new Date(), workspace = s.e.db.workspace) =>
    holds(s.e.db.payload, { workspace, now })

  it('names an observing Product with the tickets that wait behind it', async () => {
    expect((await find()).filter((h) => h.kind === 'product-observing')).toEqual([
      { kind: 'product-observing', product: s.e.db.product, name: 'p', waiting: 14 },
    ])
    await run(sql`UPDATE "products" SET "state" = 'active'`)
    expect((await find()).filter((h) => h.kind === 'product-observing')).toEqual([])
  })

  it('names the stuck tickets in one hold', async () => {
    const stuck = (await find()).filter((h) => h.kind === 'tickets-stuck')
    expect(stuck).toHaveLength(1)
    const ids = stuck.flatMap((h) => (h.kind === 'tickets-stuck' ? h.tickets.map((t) => t.recordId) : []))
    expect(ids.sort()).toEqual([s.names.failedRuns, s.names.reporterSilent, s.names.verifyRounds].sort())
  })

  it('names one line per role with the queued runs by stage when no session was seen in ten minutes', async () => {
    const queued = (now: Date) => find(now).then((all) => all.filter((h) => h.kind === 'no-agent-connected'))
    expect(await queued(new Date())).toEqual([
      {
        kind: 'no-agent-connected', role: 'builder', queued: 3,
        byStage: [{ stage: 'brief', queued: 1 }, { stage: 'build', queued: 1 }, { stage: 'intake', queued: 1 }],
      },
      { kind: 'no-agent-connected', role: 'reviewer', queued: 1, byStage: [{ stage: 'verify', queued: 1 }] },
      { kind: 'no-agent-connected', role: 'verifier', queued: 1, byStage: [{ stage: 'verify', queued: 1 }] },
    ])
    await session('builder', new Date(Date.now() - 11 * MIN))
    await session('verifier', new Date(), true)
    expect(await queued(new Date())).toHaveLength(3)
    await session('builder', new Date(Date.now() - 5 * MIN))
    const silent = (await queued(new Date())).map((h) => h.kind === 'no-agent-connected' && h.role)
    expect(silent).toEqual(['reviewer', 'verifier'])
  })

  it('shows no cannot-run line when no run is queued, even with no session connected', async () => {
    const ws = s.e.db.workspace
    const shift = (days: number) => run(sql`UPDATE "agent_sessions"
      SET "last_seen_at" = "last_seen_at" + ${days} * interval '1 day' WHERE "workspace_id" = ${ws}`)
    await shift(-1)
    const cleared: number[] = []
    try {
      const roles = (await find()).flatMap((h) => (h.kind === 'no-agent-connected' ? [h.role] : []))
      expect(roles).toEqual(['builder', 'reviewer', 'verifier'])
      const done = await run(sql`UPDATE "stage_runs" SET "status" = 'done' WHERE "status" = 'queued' RETURNING "id"`)
      cleared.push(...done.rows.map((row) => Number(row.id)))
      const kinds = (await find()).map((h) => h.kind)
      expect(kinds).not.toContain('no-agent-connected')
      expect(kinds).not.toContain('runner-idle')
    } finally {
      if (cleared.length > 0) {
        const list = sql.join(cleared.map((id) => sql`${id}`), sql`, `)
        await run(sql`UPDATE "stage_runs" SET "status" = 'queued' WHERE "id" IN (${list})`)
      }
      await shift(1)
    }
  })

  it('asks for a session only for session Products; a Runner Product holds when its run waits', async () => {
    await run(sql`UPDATE "products" SET "executor" = 'runner'`)
    const kinds = async () => (await find()).map((h) => h.kind)
    expect(await kinds()).not.toContain('no-agent-connected')
    expect(await kinds()).not.toContain('runner-idle')
    await run(sql`UPDATE "stage_runs" SET "created_at" = now() - interval '11 minutes' WHERE "status" = 'queued'`)
    expect((await find()).filter((h) => h.kind === 'runner-idle')).toEqual([{ kind: 'runner-idle', queued: 5 }])
    await run(sql`UPDATE "products" SET "executor" = 'session'`)
    expect(await kinds()).not.toContain('runner-idle')
  })

  it('names a source whose last sync failed, only in its own Workspace', async () => {
    await run(sql`UPDATE "ticket_sources" SET "last_error" = 'boom', "last_polled_at" = now()`)
    expect((await find()).filter((h) => h.kind === 'sync-failed')).toMatchObject([{ repo: 'acme/app', error: 'boom' }])
    expect(await find(new Date(), s.e.db.otherWorkspace)).toEqual([
      { kind: 'no-agent-connected', role: 'builder', queued: 1, byStage: [{ stage: 'intake', queued: 1 }] },
    ])
  })
})

describe('ticket', () => {
  beforeAll(async () => {
    await run(sql`UPDATE "mirror_items" SET "title" = 'Export report ' || "number" WHERE "title" LIKE 'Ticket %'`)
    const pr = await s.item(1, { kind: 'pr', state: 'merged', head: 'h1' })
    await run(sql`INSERT INTO "mirror_checks" ("workspace_id", "item_id", "sha", "name", "status", "conclusion",
      "updated_at", "created_at") VALUES (${s.e.db.workspace}, ${pr}, 'h1', 'ci', 'completed', 'success', now(), now()),
      (${s.e.db.workspace}, ${pr}, 'old', 'ci', 'completed', 'failure', now(), now())`)
    await run(sql`INSERT INTO "proofs" ("workspace_id", "record_id", "criterion", "kind", "source", "sha", "body",
      "updated_at", "created_at") VALUES (${s.e.db.workspace}, ${s.names.verifying}, 'c1', 'test', 'ci', 'h1', 'ok',
      now(), now()), (${s.e.db.workspace}, ${s.names.verifying}, 'c1', 'screenshot', 'run', 'h1', 'shot', now(), now()),
      (${s.e.db.workspace}, ${s.names.verifying}, 'c2', 'test', 'ci', 'h1', 'ok', now(), now())`)
  })

  const view = (recordId: number, workspace = s.e.db.workspace) => ticket(s.e.db.payload, { workspace, recordId })

  it('gathers the record, card, source issue, events, runs, proofs, pull request and similar tickets', async () => {
    const t = await view(s.names.verifying)
    expect(t).toMatchObject({ recordId: s.names.verifying, stage: 'verify', waitingOn: 'agents', card: null })
    expect(t.version).toBeGreaterThan(1)
    expect(t.record.goal).toBe('Fix it')
    expect(t.source).toMatchObject({ repo: 'acme/app', body: 'body', url: `https://forge/${t.source?.number}` })
    expect(t.events.map((e) => e.type)).toContain('build.submitted')
    expect(t.events.find((e) => e.type === 'build.submitted')?.label).toBe('A patch was submitted as pull request #1')
    expect(t.runs.map((r) => [r.stage, r.status])).toEqual([
      ['intake', 'submitted'], ['brief', 'submitted'], ['build', 'submitted'], ['verify', 'submitted'],
      ['verify', 'queued'],
    ])
    expect(t.proofs.map((g) => [g.criterion, g.proofs.map((p) => p.kind)])).toEqual([
      ['c1', ['test', 'screenshot']], ['c2', ['test']],
    ])
    expect(t.pullRequest).toMatchObject({ number: 1, headSha: 'h1', checks: [{ name: 'ci', conclusion: 'success' }] })
    expect(t.similarItems).toHaveLength(3)
    expect(t.similarItems.map((i) => i.title)).not.toContain(t.source?.title)
    expect(t.similarItems.map((i) => i.kind)).toEqual(['issue', 'issue', 'issue'])
  })

  it('shows the open card with its sequence number', async () => {
    const t = await view(s.names.resultCard)
    expect(t.card).toMatchObject({ card: 'result', reason: 'result' })
    expect(t.card?.seq).toBeGreaterThan(0)
    expect(t.pullRequest).not.toBeNull()
  })

  it('names the ticket and its status, and reads the intake facts only in Intake', async () => {
    const waiting = await view(s.names.resultCard)
    expect(waiting).toMatchObject({ status: 'result-ready', ended: null, closedAs: null, facts: null })
    expect(waiting.number).toBe(waiting.record.source.number)
    expect(waiting.title).toBe(waiting.source?.title)
    const intake = await view(s.names.reporterAsked)
    expect(intake).toMatchObject({ status: 'reporter-asked', stage: 'intake' })
    expect(intake.facts?.rounds).toEqual([])
  })

  it('shows an accepted and a closed ticket as done', async () => {
    expect(await view(s.names.accepted)).toMatchObject({ stage: 'done', status: 'accepted', ended: 'accepted' })
    expect(await view(s.names.closed)).toMatchObject({
      stage: 'done',
      status: 'closed',
      ended: 'closed',
      closedAs: 'discarded',
    })
  })

  it('does not find a record of another Workspace', async () => {
    await expect(view(s.names.verifying, s.e.db.otherWorkspace)).rejects.toThrow(RecordNotFound)
    await expect(view(s.names.foreign)).rejects.toThrow(RecordNotFound)
    expect((await view(s.names.foreign, s.e.db.otherWorkspace)).recordId).toBe(s.names.foreign)
  })
})

describe('runPage', () => {
  const page = async (recordId: number, withCost: boolean, workspace = s.e.db.workspace) => {
    const found = await s.e.db.payload.db.drizzle.execute(
      sql`SELECT "id" FROM "stage_runs" WHERE "record_id" = ${recordId} ORDER BY "id" DESC LIMIT 1`,
    )
    return runPage(s.e.db.payload, { workspace, runId: Number(found.rows[0]?.id), withCost })
  }

  beforeAll(async () => {
    const set = sql`UPDATE "stage_runs" SET "cost_usd" = 0.74 WHERE "record_id" = ${s.names.verifying}`
    await s.e.db.payload.db.drizzle.execute(set)
  })

  it('names the ticket, the stage, the parts it was given and carries the cost only when asked', async () => {
    const withCost = await page(s.names.verifying, true)
    expect(withCost).toMatchObject({ stage: 'verify', role: 'verifier', status: 'queued', costUsd: 0.74 })
    expect(withCost.ticket.recordId).toBe(s.names.verifying)
    expect(withCost.parts.map((p) => p.label)).toEqual(['Stage skill', 'Record', 'Result schema'])
    expect(withCost.parts[1]?.detail).toBe('goal, 3 criteria, 0 decisions')
    const without = await page(s.names.verifying, false)
    expect(without.costUsd).toBeNull()
    expect(JSON.stringify(without)).not.toContain('0.74')
  })

  it('writes a handoff only for an ended build run, and does not find a run of another Workspace', async () => {
    const runs = await s.e.db.payload.db.drizzle.execute(
      sql`SELECT "id" FROM "stage_runs" WHERE "record_id" = ${s.names.verifying} AND "stage" = 'build'`,
    )
    const id = Number(runs.rows[0]?.id)
    const build = await runPage(s.e.db.payload, { workspace: s.e.db.workspace, runId: id, withCost: false })
    expect(build.handoff).toBe('built p1')
    expect((await page(s.names.verifying, false)).handoff).toBeNull()
    const foreign = { workspace: s.e.db.otherWorkspace, runId: id, withCost: false }
    await expect(runPage(s.e.db.payload, foreign)).rejects.toThrow(RunNotFound)
  })
})

describe('firstLook', () => {
  const look = (workspace = s.e.db.workspace) =>
    firstLook(s.e.db.payload, { workspace, product: s.e.db.product, now: new Date() })

  beforeAll(async () => {
    await s.item(9001, { author: 'stranger', trusted: false })
    await s.item(9002, { assignees: ['x'] })
    await s.item(9003, { updated: new Date(Date.now() - 400 * DAY).toISOString() })
    await s.item(9004, { author: 'visitor', trusted: false, labels: ['bauherr:intake'] })
    await s.item(9005, { state: 'closed' })
    await run(sql`UPDATE "products" SET "connected_at" = now()`)
    await s.item(8001, { kind: 'pr', closes: [9002], head: 'abc1234' })
    await s.item(8002, { kind: 'pr' })
    await s.item(8003, { kind: 'pr', state: 'merged' })
    const id = await s.e.db.fresh()
    await appendEvent(s.e.db.payload, id, { type: 'intake.closed', data: { reason: 'duplicate' }, actor: 'agent' })
    await advance(id, s.e.deps())
  })

  it('counts issues, pull requests and repository facts from the database', async () => {
    expect(await look()).toEqual({
      issues: {
        open: 20, readyForBrief: 7, needingInformation: 1, closedAsDuplicate: 1, withoutActivityForAYear: 1,
        heldForOutsideAuthor: 1, assignedToPerson: 1,
      },
      pullRequests: { open: 2, closingAnIssue: 1, notClosingAnIssue: 1 },
      repository: {
        requiredChecks: [], syncCompleted: false, issuesMirrored: 21, pullRequestsMirrored: 4,
        suggestForgeChecks: false,
        repositories: [{
          repo: 'acme/app', defaultBranch: null, branchProtected: null, requiredChecksOnForge: [],
          hasAgentsFile: null, issueForms: null, readAt: null,
        }],
      },
    })
  })

  it('reports required checks and a completed sync', async () => {
    await run(sql`UPDATE "products" SET "required_checks" = 'ci, lint'`)
    await run(sql`UPDATE "ticket_sources" SET "imported_at" = now()`)
    expect((await look()).repository).toMatchObject({ requiredChecks: ['ci', 'lint'], syncCompleted: true })
  })

  const setFacts = (protectedState: string, checks: string[]) => run(sql`
    UPDATE "ticket_sources" SET "default_branch" = 'main', "branch_protected" = ${protectedState},
      "required_check_names" = ${JSON.stringify(checks)}::jsonb, "has_agents_file" = true, "issue_form_count" = 3,
      "facts_at" = '2026-11-19T10:00:00Z'::timestamptz`)

  it('returns the facts read from the forge and suggests its checks while the Product has none', async () => {
    await run(sql`UPDATE "products" SET "required_checks" = NULL`)
    await setFacts('yes', ['ci', 'lint'])
    const { repository } = await look()
    expect(repository.repositories).toEqual([{
      repo: 'acme/app', defaultBranch: 'main', branchProtected: 'yes', requiredChecksOnForge: ['ci', 'lint'],
      hasAgentsFile: true, issueForms: 3, readAt: '2026-11-19T10:00:00.000Z',
    }])
    expect(repository.suggestForgeChecks).toBe(true)
    await run(sql`UPDATE "products" SET "required_checks" = 'ci'`)
    expect((await look()).repository.suggestForgeChecks).toBe(false)
  })

  it('returns unknown protection as unknown and suggests nothing without checks on the forge', async () => {
    await run(sql`UPDATE "products" SET "required_checks" = NULL`)
    await setFacts('unknown', [])
    const { repository } = await look()
    expect(repository.repositories[0]).toMatchObject({ branchProtected: 'unknown', requiredChecksOnForge: [] })
    expect(repository.suggestForgeChecks).toBe(false)
  })

  it('shows the facts of the Workspace asked for only', async () => {
    await setFacts('yes', ['ci'])
    expect((await look(s.e.db.otherWorkspace)).repository.repositories).toEqual([])
  })

  it('makes a fixed number of queries', async () => {
    const execute = vi.spyOn(s.e.db.payload.db.drizzle, 'execute')
    await look()
    const calls = execute.mock.calls.length
    execute.mockRestore()
    expect(calls).toBeLessThanOrEqual(QUERIES)
  })

  it('counts only the records and mirror items of the Workspace asked for', async () => {
    expect(await look(s.e.db.otherWorkspace)).toEqual({
      issues: {
        open: 0, readyForBrief: 1, needingInformation: 0, closedAsDuplicate: 0, withoutActivityForAYear: 0,
        heldForOutsideAuthor: 0, assignedToPerson: 0,
      },
      pullRequests: { open: 0, closingAnIssue: 0, notClosingAnIssue: 0 },
      repository: {
        requiredChecks: [], syncCompleted: false, issuesMirrored: 0, pullRequestsMirrored: 0,
        suggestForgeChecks: false, repositories: [],
      },
    })
  })
})
