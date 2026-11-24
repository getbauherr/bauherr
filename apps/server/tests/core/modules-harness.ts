import { FakeBackend } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import { z } from 'zod'
import type { Role } from '../../src/core/lifecycle'
import { enterIssues } from '../../src/core/intake/enter'
import { createWriter } from '../../src/core/forge/writer'
import { readEvents, readRecord } from '../../src/core/record/store'
import { claim } from '../../src/core/run/leases'
import { submit, type SubmitDeps } from '../../src/core/submit'
import { mergeVia } from '../../src/jobs/engine-deps'
import { MODULES } from '../../src/lean'
import { intakeHarness } from './intake-harness'
import { readerOf } from './mirror-harness'

export const FORM = [
  '### What happened',
  'The list is empty.',
  '### What was expected',
  'The rows.',
  '### Steps to reproduce',
  'Open it.',
  '### Where',
  'The list page.',
].join('\n')

export const BRIEF = {
  goal: 'Show the rows in the list',
  criteria: [
    { text: 'The list shows its rows', verify: { kind: 'test', how: 'list test' } },
    { text: 'The list loads without an error', verify: { kind: 'command', how: 'run the loader' } },
    { text: 'The page looks right', verify: { kind: 'screenshot', how: 'open the page' } },
  ],
  outOfScope: ['export'],
  visible: false,
  risk: { door: 'two-way', areas: [], rollback: 'revert' },
  decisions: [],
  plan: ['fix the query'],
  shape: '- src/list.ts: query()\n+ src/list.ts: query(limit)',
}

export const buildResult = (pr: number, headSha: string, patchId: string, addressed: string[] = []) => ({
  pr,
  headSha,
  patchId,
  selfCheck: ['c1', 'c2', 'c3'].map((criterion) => ({ criterion, status: 'met', pointer: 'src/list.ts' })),
  handoff: 'Open the list page and check the rows.',
  addressed,
})

export const finding = (status: string) => ({
  id: 'f1',
  axis: 'spec',
  text: 'The list drops the last row',
  evidence: { kind: 'repro', pointer: 'open the list with three rows' },
  status,
})

const reviewTarget = z.object({ patchId: z.string(), headSha: z.string() })

export const flowHarness = (suite: string) => {
  const ih = intakeHarness(suite)
  const { h, product } = ih
  const writer = () => createWriter(h.payload(), { backend: async () => fake(), now: () => ih.clock.now })
  let current: FakeBackend | null = null
  const fake = (): FakeBackend => {
    if (!current) throw new Error('call start first')
    return current
  }
  const subDeps = (): SubmitDeps => ({
    ...ih.deps(),
    modules: MODULES,
    forge: writer(),
    merge: mergeVia(h.payload(), writer()),
  })

  const start = async (state: 'active' | 'observing') => {
    const repo = h.fresh()
    current = new FakeBackend({ native: true, user: 'jo', trusted: ['jo'] })
    await product(sql`"state" = ${state}, "required_checks" = 'ci'`)
    current.actingAs = 'jo'
    await current.tickets(repo).create({ title: 'list is empty', body: FORM })
    current.actingAs = 'factory'
    const readers = { [repo]: readerOf(current) }
    await h.settle(readers)
    const [id] = await enterIssues(subDeps())
    if (id === undefined) throw new Error('no record was created')
    return { repo, id, sync: () => h.sync(readers, ih.reacting) }
  }

  const startAdopted = async (state: 'active' | 'observing') => {
    const repo = h.fresh()
    current = new FakeBackend({ native: true, user: 'jo', trusted: ['jo'] })
    const connectedAt = ih.clock.now.toISOString()
    await product(sql`"state" = ${state}, "required_checks" = 'ci', "connected_at" = ${connectedAt}::timestamptz`)
    current.actingAs = 'jo'
    await current.tickets(repo).create({ title: 'list is empty', body: FORM })
    await current.forge.createBranch(repo, 'fix')
    const headSha = current.commit(repo, 'fix', 'a.txt', 'author-1')
    const pull = await current.forge.openPullRequest(repo, {
      title: 'fix the list',
      head: 'fix',
      base: 'main',
      body: 'Closes #1',
    })
    current.actingAs = 'factory'
    const readers = { [repo]: readerOf(current) }
    await h.settle(readers)
    const [id] = await enterIssues(subDeps())
    if (id === undefined) throw new Error('no record was adopted')
    return { repo, id, pr: pull.number, headSha, sync: () => h.sync(readers, ih.reacting) }
  }

  const claimRun = async (recordId: number, role: Role, by = `exec-${role}`) => {
    const claimed = await claim(h.payload(), { workspace: h.ids.workspace, role, by, now: ih.clock.now })
    if (!claimed || claimed.run.recordId !== recordId) throw new Error(`no ${role} run for record ${recordId}`)
    return claimed
  }

  const submitTo = (claimed: Awaited<ReturnType<typeof claimRun>>, result: unknown) =>
    submit(claimed.run.id, claimed.token, result, subDeps())

  const queuedRole = async (recordId: number): Promise<string | null> => {
    const found = await h.payload().db.drizzle.execute(
      sql`SELECT "role" FROM "stage_runs" WHERE "record_id" = ${recordId} AND "status" = 'queued'`,
    )
    return found.rows[0] ? z.object({ role: z.string() }).parse(found.rows[0]).role : null
  }

  const work = async (recordId: number, role: Role, result: unknown, by = `exec-${role}`) => {
    const target = reviewTarget.safeParse(result)
    if (role === 'verifier' && target.success && (await queuedRole(recordId)) === 'reviewer') {
      await submitTo(await claimRun(recordId, 'reviewer'), { ...target.data, findings: [] })
    }
    return submitTo(await claimRun(recordId, role, by), result)
  }

  const proof = async (recordId: number, criterion: string): Promise<string> => {
    const inserted = await h.payload().db.drizzle.execute(sql`
      INSERT INTO "proofs" ("workspace_id", "record_id", "criterion", "kind", "source", "sha", "body",
        "updated_at", "created_at")
      VALUES (${h.ids.workspace}, ${recordId}, ${criterion}, 'output', 'session', 'sha', 'ok', now(), now())
      RETURNING "id"`)
    return String(z.object({ id: z.coerce.number() }).parse(inserted.rows[0]).id)
  }

  const types = async (recordId: number) => (await readEvents(h.payload(), recordId)).map((e) => e.type)
  const view = (recordId: number) => readRecord(h.payload(), recordId)
  const comments = async (repo: string) => fake().tickets(repo).listComments('1')

  const pullFor = async (repo: string, branch: string, file: string) => {
    const forge = fake().forge
    const existing = (await forge.listOpenPullRequests(repo, 1, 10)).find((p) => p.head === branch)
    if (!existing) await forge.createBranch(repo, branch)
    const headSha = fake().commit(repo, branch, file, `${file}-${branch}`)
    if (existing) await forge.getPullRequest(repo, existing.number)
    const pull = existing ?? (await forge.openPullRequest(repo, { title: 'fix', head: branch, base: 'main' }))
    return { headSha, number: pull.number }
  }

  const green = (repo: string, sha: string, conclusion = 'success') =>
    fake().setChecks(repo, sha, [{ name: 'ci', status: 'completed', conclusion }])

  const toVerify = async (conclusion = 'success') => {
    const s = await start('active')
    await work(s.id, 'builder', { outcome: 'accepted', type: 'bug', reason: 'clear' })
    await work(s.id, 'builder', BRIEF)
    const pull = await pullFor(s.repo, 'fix', 'a.txt')
    await work(s.id, 'builder', buildResult(pull.number, pull.headSha, 'p1'), 'exec-builder')
    await s.sync()
    green(s.repo, pull.headSha, conclusion)
    await s.sync()
    return { ...s, pull }
  }

  const backdateAsked = (recordId: number) =>
    h.rows(sql`UPDATE "events" SET "created_at" = '2025-12-01T00:00:00Z'
      WHERE "record_id" = ${recordId}
        AND ("type" = 'intake.asked' OR ("type" = 'forge.write.done' AND "data"->>'kind' = 'question'))`)

  const steps = {
    start,
    startAdopted,
    work,
    claimRun,
    submitTo,
    proof,
    types,
    view,
    comments,
    pullFor,
    green,
    toVerify,
  }
  return { ...ih, ...steps, fake, subDeps, backdateAsked }
}

export type Flow = ReturnType<typeof flowHarness>
