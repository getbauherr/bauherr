import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { callTool } from '../../src/core/run/mcp/registry'
import type { Contexts } from '../../src/core/run/mcp/tool'
import { skillFor, tierFor } from '../../src/lean'
import { mintAgentKey, resolveAgentKey } from '../../src/lib/api-key'
import { BRIEF, buildResult, finding, flowHarness } from './modules-harness'

const f = flowHarness('core_reviewer_flow')

const work = z.object({
  runId: z.number(),
  leaseToken: z.string(),
  context: z.object({
    role: z.string(),
    skill: z.string().nullable(),
    record: z.object({ handoff: z.string() }),
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

const session = async (contexts: Agent, role: string) => {
  const connected = await callTool('connect', { role, clientSession: 'test-session-1' }, contexts)
  return z.object({ session: z.string() }).parse(connected).session
}

const take = async (contexts: Agent, id: string) =>
  work.parse(await callTool('next_work', { session: id }, contexts))

const submit = async (contexts: Agent, run: z.infer<typeof work>, result: unknown) =>
  z.object({ status: z.string() }).parse(
    await callTool('submit', { runId: run.runId, leaseToken: run.leaseToken, result }, contexts),
  )

const verdict = async (recordId: number, headSha: string, patchId: string, change: object) => {
  const criteria = []
  for (const criterion of ['c1', 'c2', 'c3']) {
    criteria.push({ id: criterion, status: 'met', proof: [await f.proof(recordId, criterion)] })
  }
  const base = { headSha, patchId, criteria, findings: [], verdict: 'pass' }
  return { ...base, changes: [], walkthrough: [], notVerified: [], ...change }
}

describe('builder, reviewer and verifier sessions on the fake forge', () => {
  it('sends a reviewer finding back to Build with the verifier changes; the second review settles it', async () => {
    const s = await f.start('active')
    await f.work(s.id, 'builder', { outcome: 'accepted', type: 'bug', reason: 'clear' })
    await f.work(s.id, 'builder', BRIEF)
    const contexts = await agent()
    const builder = await session(contexts, 'builder')
    const reviewer = await session(contexts, 'reviewer')
    const verifier = await session(contexts, 'verifier')

    const build = await take(contexts, builder)
    const first = await f.pullFor(s.repo, 'fix', 'a.txt')
    await submit(contexts, build, buildResult(first.number, first.headSha, 'p1'))
    expect(await f.view(s.id)).toMatchObject({ stage: 'verify', waitingOn: 'agents' })
    expect(await callTool('next_work', { session: verifier }, contexts)).toEqual({ status: 'idle' })
    await s.sync()
    f.green(s.repo, first.headSha)
    await s.sync()

    const review = await take(contexts, reviewer)
    expect(review.context.role).toBe('reviewer')
    expect(review.context.skill).toMatch(/^# Review/)
    expect(review.context.record.handoff).toBe('')
    const found = { headSha: first.headSha, patchId: 'p1', findings: [finding('open')] }
    expect(await submit(contexts, review, found)).toEqual({ status: 'accepted' })
    expect((await f.view(s.id)).record.findings.map((x) => x.status)).toEqual(['open'])

    const check = await take(contexts, verifier)
    expect(check.context.role).toBe('verifier')
    expect(check.context.skill).toMatch(/^# Verify/)
    const changes = await verdict(s.id, first.headSha, 'p1', { verdict: 'changes', findings: [finding('open')] })
    await submit(contexts, check, changes)
    expect(await f.view(s.id)).toMatchObject({ stage: 'build', waitingOn: 'agents' })

    const again = await take(contexts, builder)
    const second = await f.pullFor(s.repo, 'fix', 'b.txt')
    await submit(contexts, again, buildResult(second.number, second.headSha, 'p2', ['f1']))
    expect((await f.view(s.id)).record.findings.map((x) => x.status)).toEqual(['fixing'])
    await s.sync()
    f.green(s.repo, second.headSha)
    await s.sync()

    const recheck = await take(contexts, reviewer)
    await submit(contexts, recheck, { headSha: second.headSha, patchId: 'p2', findings: [finding('fixed')] })
    expect((await f.view(s.id)).record.findings.map((x) => x.status)).toEqual(['fixed'])

    const last = await take(contexts, verifier)
    await submit(contexts, last, await verdict(s.id, second.headSha, 'p2', {}))
    expect(await f.view(s.id)).toMatchObject({ stage: 'ship', waitingOn: 'owner' })
    const types = await f.types(s.id)
    const fromBuild = types.slice(types.indexOf('build.submitted'))
    const wanted = ['build.submitted', 'review.submitted', 'verify.changes', 'verify.passed']
    expect(fromBuild.filter((t) => wanted.includes(t))).toEqual([
      'build.submitted',
      'review.submitted',
      'verify.changes',
      'build.submitted',
      'review.submitted',
      'verify.passed',
    ])
  })
})
