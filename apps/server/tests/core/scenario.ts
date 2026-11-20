import { sql } from '@payloadcms/db-postgres'
import { z } from 'zod'
import { advance } from '../../src/core/engine'
import { decide } from '../../src/core/decide'
import { appendEvent, readRecord, setParked, setProjection, setRank } from '../../src/core/record/store'
import { claim } from '../../src/core/run/leases'
import { finishRun } from '../../src/core/run/store'
import { submit } from '../../src/core/submit'
import type { Engine } from './harness'

const o = { overrideAccess: true } as const
const idOf = (doc: { id: number | string }) => z.coerce.number().parse(doc.id)

export type ScenarioNames = Record<
  | 'intakeQueued' | 'intakeWorking' | 'reporterAsked' | 'failedRuns' | 'reporterSilent'
  | 'briefQueued' | 'briefCard' | 'building' | 'verifyRounds' | 'waitingChecks' | 'verifying'
  | 'resultCard' | 'accepted' | 'closed' | 'parked',
  number
>

export type ItemFields = Partial<{
  kind: 'issue' | 'pr'
  title: string
  author: string
  trusted: boolean
  state: string
  labels: string[]
  assignees: string[]
  closes: number[]
  updated: string
  head: string
}>

export const mirrorSource = async (e: Pick<Engine, 'db'>, repo = 'acme/app') => {
  const { payload, workspace, product } = e.db
  const connection = idOf(await payload.create({
    collection: 'connections', data: { name: 'gh', kind: 'github', workspace }, ...o,
  }))
  const source = idOf(await payload.create({
    collection: 'ticket_sources', data: { repo, product, connection, workspace }, ...o,
  }))
  const item = async (number: number, fields: ItemFields = {}): Promise<number> => {
    const f = {
      kind: 'issue', title: `Ticket ${number}`, author: 'jo', trusted: true, state: 'open', labels: [],
      assignees: [], closes: [], updated: new Date().toISOString(), head: '', ...fields,
    }
    const json = (value: unknown) => JSON.stringify(value)
    const url = `https://forge/${f.kind === 'pr' ? 'pull/' : ''}${number}`
    const result = await payload.db.drizzle.execute(sql`
      INSERT INTO "mirror_items" ("workspace_id", "source_id", "product_id", "repo", "number", "kind", "title", "body",
        "state", "author", "author_trusted", "author_is_bot", "labels", "assignees", "url", "forge_created_at",
        "forge_updated_at", "head_sha", "closes", "draft", "synced_at", "updated_at", "created_at")
      VALUES (${workspace}, ${source}, ${product}, ${repo}, ${number}, ${f.kind}, ${f.title}, 'body', ${f.state},
        ${f.author}, ${f.trusted}, false, ${json(f.labels)}::jsonb, ${json(f.assignees)}::jsonb,
        ${url}, now() - interval '1 day', ${f.updated}::timestamptz, ${f.head},
        ${json(f.closes)}::jsonb, false, now(), now(), now())
      RETURNING "id"`)
    return z.object({ id: z.coerce.number() }).parse(result.rows[0]).id
  }
  return { source, item }
}

export const workOn = async (e: Engine, id: number, role: 'builder' | 'verifier', result: unknown) => {
  await setRank(e.db.payload, id, -1000)
  try {
    return await e.work(id, role, result)
  } finally {
    await setRank(e.db.payload, id, 0)
  }
}

export const begin = async (e: Engine): Promise<number> => {
  const id = await e.db.fresh()
  await advance(id, e.deps())
  return id
}

export const toBrief = async (e: Engine, open: boolean): Promise<number> => {
  const id = await begin(e)
  await workOn(e, id, 'builder', { verdict: 'accept' })
  await workOn(e, id, 'builder', { goal: 'Fix it', open })
  return id
}

export const patch = async (e: Engine, id: number, n: number) => {
  await workOn(e, id, 'builder', { patchId: `p${n}`, headSha: `h${n}`, pr: n })
  await e.checks(id)
}

export const asked = async (e: Engine, id: number, round: number) => {
  await setRank(e.db.payload, id, -1000)
  const input = { workspace: e.db.workspace, role: 'builder', by: 'x', now: e.clock.now } as const
  const claimed = await claim(e.db.payload, input)
  await setRank(e.db.payload, id, 0)
  if (!claimed) throw new Error('no run queued')
  await finishRun(e.db.payload, claimed.run.id, { status: 'submitted', now: e.clock.now })
  await appendEvent(e.db.payload, id, { type: 'intake.asked', data: { round }, actor: 'agent' })
  const target = { repo: 'acme/app', number: 1 }
  const done = { type: 'forge.write.done', data: { kind: 'question', target }, actor: 'factory' } as const
  await appendEvent(e.db.payload, id, done)
  await advance(id, e.deps())
}

const failedRun = async (e: Engine, id: number) => {
  await setRank(e.db.payload, id, -1000)
  const claimed = await claim(e.db.payload, { workspace: e.db.workspace, role: 'builder', by: 'x', now: e.clock.now })
  await setRank(e.db.payload, id, 0)
  if (!claimed) throw new Error('no run queued')
  await submit(claimed.run.id, claimed.token, {}, e.deps())
  await submit(claimed.run.id, claimed.token, {}, e.deps())
}

const stuckVerify = async (e: Engine): Promise<number> => {
  const id = await toBrief(e, false)
  await patch(e, id, 1)
  await workOn(e, id, 'verifier', { passed: false, patchId: 'p1', headSha: 'h1' })
  await patch(e, id, 2)
  await workOn(e, id, 'verifier', { passed: false, patchId: 'p2', headSha: 'h2' })
  return id
}

const stuckSilent = async (e: Engine): Promise<number> => {
  const id = await begin(e)
  for (const round of [1, 2]) {
    await asked(e, id, round)
    await appendEvent(e.db.payload, id, { type: 'reporter.silent', data: {}, actor: 'factory' })
    await advance(id, e.deps())
  }
  return id
}

export type Scenario = {
  names: ScenarioNames
  source: number
  item: (n: number, fields?: ItemFields) => Promise<number>
}

export const seedScenario = async (e: Engine, title?: (name: keyof ScenarioNames) => string): Promise<Scenario> => {
  const mirror = await mirrorSource(e)
  const accept = async (id: number) => {
    const card = { ask: 'result', choice: 'accept', seq: await e.seq(id) }
    await decide(id, e.owner, card, e.deps())
  }
  const toResult = async () => {
    const id = await toBrief(e, false)
    await patch(e, id, 1)
    await workOn(e, id, 'verifier', { passed: true, patchId: 'p1', headSha: 'h1' })
    return id
  }
  const reporterAsked = await begin(e)
  await asked(e, reporterAsked, 1)
  const failedRuns = await begin(e)
  await failedRun(e, failedRuns)
  await failedRun(e, failedRuns)
  const closed = await begin(e)
  await appendEvent(e.db.payload, closed, { type: 'ticket.closed', data: { reason: 'discarded' }, actor: 'owner' })
  await advance(closed, e.deps())
  const release = sql`UPDATE "stage_runs" SET "status" = 'released' WHERE "record_id" = ${closed}`
  await e.db.payload.db.drizzle.execute(release)
  const parked = await e.db.fresh()
  await setParked(e.db.payload, parked, 'limit reached')
  await setProjection(e.db.payload, parked, { stage: 'brief', waitingOn: 'nobody' })
  const names: Partial<ScenarioNames> = {
    reporterAsked, failedRuns, closed, parked,
    reporterSilent: await stuckSilent(e),
    briefCard: await toBrief(e, true),
    verifyRounds: await stuckVerify(e),
    resultCard: await toResult(),
    accepted: await toResult(),
  }
  await accept(names.accepted ?? 0)
  names.waitingChecks = await toBrief(e, false)
  await workOn(e, names.waitingChecks, 'builder', { patchId: 'p1', headSha: 'h1', pr: 1 })
  names.verifying = await toBrief(e, false)
  await patch(e, names.verifying, 1)
  names.building = await toBrief(e, false)
  names.briefQueued = await begin(e)
  await workOn(e, names.briefQueued, 'builder', { verdict: 'accept' })
  names.intakeWorking = await begin(e)
  await setRank(e.db.payload, names.intakeWorking, -1000)
  await claim(e.db.payload, { workspace: e.db.workspace, role: 'builder', by: 'worker-1', now: e.clock.now })
  await setRank(e.db.payload, names.intakeWorking, 0)
  names.intakeQueued = await begin(e)
  const full = names as ScenarioNames
  for (const [name, id] of Object.entries(full)) {
    const { source } = (await readRecord(e.db.payload, id)).record
    const named = title === undefined ? {} : { title: title(name as keyof ScenarioNames) }
    await mirror.item(source.number, named)
  }
  return { names: full, source: mirror.source, item: mirror.item }
}
