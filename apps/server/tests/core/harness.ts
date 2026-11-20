import { sql } from '@payloadcms/db-postgres'
import { z } from 'zod'
import type { MergeFn } from '../../src/core/engine'
import { advance } from '../../src/core/engine'
import { fold, type Config, type Role } from '../../src/core/lifecycle'
import { defineModule, type Modules } from '../../src/core/module'
import { appendEvent, readEvents, readRecord } from '../../src/core/record/store'
import { claim } from '../../src/core/run/leases'
import { submit } from '../../src/core/submit'
import { openCoreDb, type CoreDb } from './db'
import { CONFIG, criterion, decision } from './fixtures'

const intake = defineModule({
  stage: 'intake',
  role: 'builder',
  writes: [],
  resultSchema: z.object({ verdict: z.enum(['accept', 'dispute']) }),
  apply: (_record, result) => ({
    patch: {},
    events: [{ type: result.verdict === 'accept' ? 'intake.accepted' : 'intake.disputed', data: {} }],
  }),
})

const brief = defineModule({
  stage: 'brief',
  role: 'builder',
  writes: ['goal', 'criteria', 'risk', 'decisions'],
  resultSchema: z.object({ goal: z.string().min(1), open: z.boolean() }),
  apply: (_record, result, run) => ({
    patch: {
      goal: result.goal,
      criteria: [criterion(1), criterion(2), criterion(3)],
      risk: { door: 'two-way', areas: [], rollback: 'revert' },
      decisions: result.open ? [decision(1)] : [],
    },
    events: [{ type: 'brief.submitted', data: { runId: String(run.id) } }],
  }),
})

const build = defineModule({
  stage: 'build',
  role: 'builder',
  writes: ['handoff'],
  resultSchema: z.object({
    patchId: z.string().min(1),
    headSha: z.string().min(1),
    pr: z.number().int().positive(),
  }),
  apply: (_record, result, run) => ({
    patch: { handoff: `built ${result.patchId}` },
    events: [
      {
        type: 'build.submitted',
        data: { runId: String(run.id), patchId: result.patchId, headSha: result.headSha, pr: result.pr },
      },
    ],
  }),
})

const verify = defineModule({
  stage: 'verify',
  role: 'verifier',
  writes: ['handoff'],
  resultSchema: z.object({ passed: z.boolean(), patchId: z.string().min(1), headSha: z.string().min(1) }),
  apply: (_record, result, run) => ({
    patch: { handoff: `verified ${result.patchId}` },
    events: [
      {
        type: result.passed ? 'verify.passed' : 'verify.changes',
        data: { runId: String(run.id), patchId: result.patchId, headSha: result.headSha },
      },
    ],
  }),
})

export const TEST_MODULES: Modules = { intake, brief, build, verify }

export type Engine = {
  db: CoreDb
  config: Config
  merges: number[]
  clock: { now: Date }
  mergeWith: { fn: MergeFn }
  deps: () => Parameters<typeof advance>[1] & { modules: Modules }
  work: (recordId: number, role: Role, result: unknown) => Promise<Awaited<ReturnType<typeof submit>>>
  view: (recordId: number) => Promise<{ stage: string; waitingOn: string; card: unknown; types: string[] }>
  checks: (recordId: number, passed?: boolean) => Promise<void>
  owner: { id: string; role: string; workspaceIds: number[] }
  seq: (recordId: number) => Promise<number>
  drain: () => Promise<void>
  drop: () => Promise<void>
}

const CLOCK = '2026-11-19T10:00:00Z'

export const engineOn = (db: CoreDb, modules: Modules = TEST_MODULES, now = new Date(CLOCK)): Engine => {
  const merges: number[] = []
  const clock = { now }
  const mergeWith: { fn: MergeFn } = {
    fn: (target) => {
      merges.push(target.pr)
      return Promise.resolve({ sha: `sha-${target.pr}` })
    },
  }
  const engine: Engine = {
    db,
    config: { ...CONFIG },
    merges,
    clock,
    mergeWith,
    deps: () => ({
      payload: db.payload,
      configFor: () => Promise.resolve(engine.config),
      now: clock.now,
      merge: (target) => mergeWith.fn(target),
      modules,
    }),
    work: async (recordId, role, result) => {
      const claimed = await claim(db.payload, { workspace: db.workspace, role, by: 'executor', now: clock.now })
      if (!claimed || claimed.run.recordId !== recordId) throw new Error(`no ${role} run queued for record ${recordId}`)
      return submit(claimed.run.id, claimed.token, result, engine.deps())
    },
    view: async (recordId) => {
      const stored = await readRecord(db.payload, recordId)
      const events = await readEvents(db.payload, recordId)
      return { stage: stored.stage, waitingOn: stored.waitingOn, card: stored.card, types: events.map((e) => e.type) }
    },
    checks: async (recordId, passed = true) => {
      const state = fold(await readEvents(db.payload, recordId))
      const patchId = state.patch?.id ?? ''
      await appendEvent(db.payload, recordId, { type: 'checks.finished', data: { patchId, passed }, actor: 'factory' })
      await advance(recordId, engine.deps())
    },
    owner: { id: 'u7', role: 'bauherr', workspaceIds: [db.workspace] },
    seq: async (recordId) => (await readRecord(db.payload, recordId)).card?.seq ?? -1,
    drop: () => db.drop(),
    drain: async () => {
      const live = sql`UPDATE "stage_runs" SET "status" = 'released' WHERE "status" IN ('queued', 'claimed')`
      await db.payload.db.drizzle.execute(live)
    },
  }
  return engine
}

export const openEngine = async (suite: string, modules: Modules = TEST_MODULES): Promise<Engine> =>
  engineOn(await openCoreDb(suite), modules)
