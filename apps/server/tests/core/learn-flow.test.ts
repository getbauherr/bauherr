import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { decide } from '../../src/core/decide'
import { callTool } from '../../src/core/run/mcp/registry'
import type { Contexts } from '../../src/core/run/mcp/tool'
import { statementFare, statementRecords } from '../../src/core/views/statement-records'
import { skillFor, tierFor } from '../../src/lean'
import { mintAgentKey, resolveAgentKey } from '../../src/lib/api-key'
import { BRIEF, buildResult, finding, flowHarness } from './modules-harness'

const f = flowHarness('core_learn_flow')

const memory = z.object({ id: z.number(), text: z.string() })
const work = z.object({
  runId: z.number(),
  leaseToken: z.string(),
  context: z.object({
    stage: z.string(),
    role: z.string(),
    model: z.object({ tier: z.string() }),
    skill: z.string().nullable(),
    statements: z.array(memory),
    learn: z
      .object({
        corrections: z.array(z.object({ id: z.string(), kind: z.string(), note: z.string() })),
        handed: z.array(memory),
        candidates: z.array(memory),
      })
      .nullable(),
  }),
})

type Agent = Pick<Contexts, 'agent'>

const agent = async (): Promise<Agent> => {
  const payload = f.h.payload()
  const workspace = f.h.ids.workspace
  const user = await payload.create({
    collection: 'bauherren',
    data: { email: 'agent@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: workspace }] },
    overrideAccess: true,
  })
  const token = await mintAgentKey(payload, user, 'agent', workspace)
  const keyId = z.coerce.number().parse((await resolveAgentKey(payload, token))?.keyId)
  const deps = { ...f.subDeps(), skills: skillFor, tiers: tierFor }
  return { agent: { deps, workspace, keyId, origin: 'http://factory.test' } }
}

const session = async (contexts: Agent, role: string) =>
  z.object({ session: z.string() }).parse(await callTool('connect', { role }, contexts)).session

const take = async (contexts: Agent, id: string) => work.parse(await callTool('next_work', { session: id }, contexts))

const submit = (contexts: Agent, run: z.infer<typeof work>, result: unknown) =>
  callTool('submit', { runId: run.runId, leaseToken: run.leaseToken, result }, contexts)

const verdict = async (recordId: number, headSha: string, patchId: string, findings: object[] = []) => {
  const criteria = []
  for (const criterion of ['c1', 'c2', 'c3']) {
    criteria.push({ id: criterion, status: 'met', proof: [await f.proof(recordId, criterion)] })
  }
  return { headSha, patchId, criteria, findings, verdict: 'pass', changes: [], walkthrough: [], notVerified: [] }
}

const owner = () => ({ id: 'u7', role: 'bauherr', workspaceIds: [f.h.ids.workspace] })
const choose = async (id: number, choice: string, note?: string) => {
  const seq = (await f.view(id)).card?.seq ?? -1
  await decide(id, owner(), { ask: 'result', choice, seq, ...(note === undefined ? {} : { note }) }, f.subDeps())
}
type Pulled = { id: number; repo: string; sync: () => Promise<unknown> }
const greened = async (s: Pulled, pull: { headSha: string }) => {
  await s.sync()
  f.green(s.repo, pull.headSha)
  await s.sync()
}
const rule = 'Keep the last of the rows when you show a list.'
const records = () => statementRecords(f.h.payload(), { workspace: f.h.ids.workspace, product: f.h.ids.product })

describe('a reviewer finding becomes a memory, and a later ticket corrected for it marks it as come back', () => {
  it('hands the learned memory to the next ticket and marks it when that ticket is corrected', async () => {
    const contexts = await agent()
    const builder = await session(contexts, 'builder')
    const reviewer = await session(contexts, 'reviewer')

    const first = await f.toVerify()
    await f.work(first.id, 'verifier', await verdict(first.id, first.pull.headSha, 'p1', [finding('fixed')]))
    await choose(first.id, 'accept')
    expect(await f.view(first.id)).toMatchObject({ stage: 'done', waitingOn: 'nobody' })

    const learning = await take(contexts, reviewer)
    expect(learning.context).toMatchObject({ stage: 'done', role: 'reviewer', model: { tier: 'strong' } })
    expect(learning.context.statements).toEqual([])
    expect(learning.context.skill).toMatch(/^# Learn/)
    expect(learning.context.learn).toEqual({ corrections: [], handed: [], candidates: [] })
    const kept = { lessons: [{ from: 'f1', text: rule, applies: 'fit' }], cameBack: [] }
    expect(await submit(contexts, learning, kept)).toEqual({ status: 'accepted' })
    const [learned] = await records()
    expect(learned).toMatchObject({ kind: 'learned', text: rule, isNew: true, cameBack: 0, from: 'Reviewer finding' })
    expect(await f.types(first.id)).toContain('learn.submitted')
    expect(await callTool('next_work', { session: reviewer }, contexts)).toEqual({ status: 'idle' })

    const second = await f.start('active')
    await f.work(second.id, 'builder', { outcome: 'accepted', type: 'bug', reason: 'clear' })
    await f.work(second.id, 'builder', BRIEF)
    const build = await take(contexts, builder)
    expect(build.context).toMatchObject({ stage: 'build', learn: null })
    expect(build.context.statements.map((entry) => entry.id)).toEqual([learned?.id])
    const pull = await f.pullFor(second.repo, 'fix', 'a.txt')
    await submit(contexts, build, buildResult(pull.number, pull.headSha, 'p1'))
    await greened(second, pull)
    await f.work(second.id, 'verifier', await verdict(second.id, pull.headSha, 'p1'))
    const note = 'The last row is still missing from the list.'
    await choose(second.id, 'send-back', note)
    const again = await take(contexts, builder)
    const next = await f.pullFor(second.repo, 'fix-again', 'b.txt')
    await submit(contexts, again, buildResult(next.number, next.headSha, 'p2'))
    await greened(second, next)
    await f.work(second.id, 'verifier', await verdict(second.id, next.headSha, 'p2'))
    await choose(second.id, 'accept')

    const relearning = await take(contexts, reviewer)
    expect(relearning.context.learn?.corrections).toEqual([{ id: 'n1', kind: 'send-back', note }])
    expect(relearning.context.learn?.handed).toEqual([{ id: learned?.id, text: rule }])
    const marked = { lessons: [{ from: 'n1', repeats: learned?.id }], cameBack: [learned?.id] }
    expect(await submit(contexts, relearning, marked)).toEqual({ status: 'accepted' })
    expect((await records()).find((row) => row.id === learned?.id)).toMatchObject({ handed: 2, cameBack: 1 })
    const fares = await statementFare(f.h.payload(), { workspace: f.h.ids.workspace, id: learned?.id ?? 0 })
    expect(fares.map((fare) => fare.outcome)).toEqual(['came-back', 'came-back'])
    expect(await f.types(second.id)).toContain('learn.submitted')
  })
})
