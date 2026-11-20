import { sql } from '@payloadcms/db-postgres'
import { commitAndPush, fetchBase, git, patchId, type cloneRepo } from '@bauherr/runner'
import { z } from 'zod'
import { pullDescription, pullTitle } from '../../core/forge/pull-description'
import type { State } from '../../core/fold'
import type { StoredRecord } from '../../core/record/store'
import type { Run } from '../../core/run/schema'
import type { RepoAccess, RunnerDeps } from './types'

type CloneOptions = Parameters<typeof cloneRepo>[0]
export type Checkout = Awaited<ReturnType<typeof cloneRepo>>
export type Sealed = { ok: true; facts: Record<string, unknown> } | { ok: false; reason: string }
export type Plan = { clone: CloneOptions; seal: (checkout: Checkout) => Promise<Sealed> }
export type PlanInput = { run: Run; stored: StoredRecord; state: State; access: RepoAccess; deps: RunnerDeps }

const refRow = z.object({ head_ref: z.string().nullable() })
const idRow = z.object({ id: z.coerce.number() })

const headRefOf = async ({ stored, deps }: PlanInput, pr: number): Promise<string> => {
  const found = await deps.engine().payload.db.drizzle.execute(sql`
    SELECT "head_ref" FROM "mirror_items"
    WHERE "workspace_id" = ${stored.workspace} AND "repo" = ${stored.record.source.repo}
      AND "number" = ${pr} AND "kind" = 'pr'`)
  const ref = found.rows[0] ? refRow.parse(found.rows[0]).head_ref : null
  if (ref === null) throw new Error(`Pull request #${pr} is not in the mirror yet: wait for the next sync.`)
  return ref
}

const issueItemOf = async ({ stored, deps }: PlanInput): Promise<number> => {
  const { repo, number } = stored.record.source
  const found = await deps.engine().payload.db.drizzle.execute(sql`
    SELECT "id" FROM "mirror_items"
    WHERE "workspace_id" = ${stored.workspace} AND "repo" = ${repo} AND "number" = ${number} AND "kind" = 'issue'`)
  const row = found.rows[0]
  if (!row) throw new Error(`Issue ${repo}#${number} is not in the mirror yet: wait for the next sync.`)
  return idRow.parse(row).id
}

const headFacts = async (checkout: Checkout, base: string, fetchFirst: boolean) => {
  if (fetchFirst) await fetchBase(checkout, checkout.env, base)
  return {
    headSha: await git(checkout.dir, checkout.env, 'rev-parse', 'HEAD'),
    patchId: await patchId(checkout, checkout.env, base),
  }
}

const cloneAt = (input: PlanInput, branch: string, checkout?: string): CloneOptions => ({
  ...input.access,
  branch,
  ...(checkout === undefined ? {} : { checkout }),
})

const openPull = async (input: PlanInput, checkout: Checkout): Promise<number> => {
  const { record } = input.stored
  const target = { recordId: input.stored.id, itemId: await issueItemOf(input) }
  const pull = await input.deps.writer.openPullRequest(target, {
    title: pullTitle(record),
    body: pullDescription(record),
    head: checkout.branch,
    base: input.access.defaultBranch,
  })
  return pull.number
}

const build = async (input: PlanInput): Promise<Plan> => {
  const { stored, state, run, access } = input
  const existing = state.patch
  const branch = `bauherr/${stored.record.source.number}-${run.id}`
  const clone = existing ? cloneAt(input, branch, await headRefOf(input, existing.pr)) : cloneAt(input, branch)
  return {
    clone,
    seal: async (checkout) => {
      const message = `${pullTitle(stored.record)} (#${stored.record.source.number})`
      if (!(await commitAndPush(checkout, checkout.env, message))) {
        return { ok: false, reason: 'the agent left no change in the checkout' }
      }
      const pr = existing ? existing.pr : await openPull(input, checkout)
      return { ok: true, facts: { pr, ...(await headFacts(checkout, access.defaultBranch, existing !== null)) } }
    },
  }
}

const verify = async (input: PlanInput): Promise<Plan> => {
  const { state, run, access } = input
  if (!state.patch) throw new Error('The record has no patch to verify: send it back to Build.')
  const clone = cloneAt(input, `bauherr/verify-${run.id}`, await headRefOf(input, state.patch.pr))
  const seal = async (checkout: Checkout): Promise<Sealed> => ({
    ok: true,
    facts: await headFacts(checkout, access.defaultBranch, true),
  })
  return { clone, seal }
}

export const planFor = (input: PlanInput): Promise<Plan> => {
  switch (input.run.stage) {
    case 'build':
      return build(input)
    case 'verify':
      return verify(input)
    default:
      return Promise.resolve({
        clone: cloneAt(input, `bauherr/${input.run.stage}-${input.run.id}`),
        seal: () => Promise.resolve({ ok: true, facts: {} }),
      })
  }
}
