import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

const backend = vi.hoisted(() => ({ current: null as unknown as FakeBackend }))
vi.mock('../src/lib/adapters', () => ({ backendFor: () => backend.current }))

const REPO = 'acme/knowledge'
const o = { overrideAccess: true } as const
const SKILL = '---\nname: tdd-first\ndescription: Write the failing test first.\n---\nTDDSKILL: write a failing test before the fix.\n'
const CASES = [
  { id: 'a', input: 'fix the bug', checks: { must_match: ['(?i)failing test'] } },
  { id: 'b', input: 'add the feature', checks: { must_match: ['(?i)failing test'] } },
]
const PROPOSE = { name: 'tdd-first', skill: SKILL, cases: CASES }

let payload: Payload
let lib: typeof import('../src/lib/skill-distill')
let gateway: Server
let testDb: TestDb
let seq = 0
const extractBodies: string[] = []
const calls: { kind: 'extract' | 'subject' | 'judge'; skilled: boolean }[] = []
const stub = { propose: PROPOSE as Record<string, unknown>, skilledOutput: 'I write a failing test first.', usage: { input_tokens: 100, output_tokens: 50 } }
const count = (kind: string) => calls.filter((c) => c.kind === kind).length
const forge = () => backend.current.forge

beforeAll(async () => {
  testDb = await createTestDb('skill_distill_465')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  gateway = createServer(async (req, res) => {
    let raw = ''
    for await (const c of req) raw += c
    const b = JSON.parse(raw)
    const names: string[] = (b.tools ?? []).map((t: { name: string }) => t.name)
    let content: unknown[]
    if (names.includes('propose')) {
      calls.push({ kind: 'extract', skilled: false })
      extractBodies.push(raw)
      content = [{ type: 'tool_use', id: 'u1', name: 'propose', input: stub.propose }]
    } else if (names.includes('verdict')) {
      calls.push({ kind: 'judge', skilled: false })
      content = [{ type: 'tool_use', name: 'verdict', input: { criteria: [] } }]
    } else {
      const skilled = String(b.system ?? '').includes('TDDSKILL')
      calls.push({ kind: 'subject', skilled })
      content = [{ type: 'text', text: skilled ? stub.skilledOutput : 'just code' }]
    }
    res.setHeader('content-type', 'application/json').end(JSON.stringify({ content, usage: stub.usage }))
  })
  await new Promise<void>((r) => gateway.listen(0, '127.0.0.1', r))
  process.env.GATEWAY_URL = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  lib = await import('../src/lib/skill-distill')
})

afterAll(async () => {
  gateway?.close()
  await payload?.destroy()
  await testDb?.drop(payload)
})

beforeEach(() => {
  backend.current = new FakeBackend()
  backend.current.commit(REPO, 'main', 'README.md', '# Knowledge\n')
  calls.length = 0
  extractBodies.length = 0
  stub.propose = PROPOSE
  stub.skilledOutput = 'I write a failing test first.'
  stub.usage = { input_tokens: 100, output_tokens: 50 }
})

/** A merged Ticket in its own Workspace (the daily cap is per Workspace) with `rounds` review returns. */
const seed = async (rounds: number, ws?: number) => {
  const n = ++seq
  if (!ws) {
    ws = Number((await payload.create({ collection: 'workspaces', data: { name: `w${n}`, slug: `w${n}` }, ...o })).id)
    await payload.create({ collection: 'connections', data: { name: 'llm', kind: 'llm-provider', provider: 'bedrock', awsRegion: 'us-east-1', workspace: ws }, ...o } as never)
    const conn = await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o } as never)
    await payload.update({ collection: 'workspaces', id: ws, data: { knowledgeConnection: conn.id, knowledgeRepo: REPO }, ...o })
  }
  const product = Number((await payload.create({ collection: 'products', data: { name: `p${n}`, slug: `p${n}`, workspace: ws }, ...o })).id)
  const t = await payload.create({ collection: 'tickets', data: { title: `fix ${n}`, externalId: String(n), number: n, state: 'open', stage: 'release', product, workspace: ws, reviewRounds: rounds }, ...o })
  await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'review', status: 'succeeded', mode: 'session', workspace: ws, verdict: 'changes', findings: [{ severity: 'high', file: 'a.ts', line: 1, msg: 'no test', scenario: 'regression' }] }, ...o })
  return { id: Number(t.id), ws }
}
const proposals = async (ticket: number) => (await payload.find({ collection: 'skill_proposals', where: { ticket: { equals: ticket } }, depth: 0, ...o })).docs as Record<string, any>[]
const knowledgePrs = async () => forge().listPullRequests(REPO, 'all')

/** A Ticket whose review ran at `base` and whose factory PR fixes it in `a.ts`. */
const seedWithPr = async (fixLine: string) => {
  const { id, ws } = await seed(1)
  const t = (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>
  const product = Number(t.product)
  const conn = await payload.create({ collection: 'connections', data: { name: 'src', kind: 'github', workspace: ws }, ...o } as never)
  await payload.create({ collection: 'ticket_sources', data: { repo: 'acme/web', product, connection: conn.id, workspace: ws }, ...o } as never)
  const branch = `bauherr/${t.number}-fix`
  const reviewed = await backend.current.forge.createBranch('acme/web', branch)
  backend.current.commit('acme/web', branch, 'a.ts', `${fixLine}\n`)
  const pr = await backend.current.forge.openPullRequest('acme/web', { title: 'fix', body: 'b', head: branch, base: 'main' })
  await payload.create({ collection: 'runs', data: { ticket: id, stage: 'build', status: 'succeeded', mode: 'session', workspace: ws, artifacts: { prUrl: pr.url } }, ...o } as never)
  const review = (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: id } }, { stage: { equals: 'review' } }] }, ...o })).docs[0]!
  await payload.update({ collection: 'runs', id: review.id, data: { reviewedSha: reviewed.sha }, ...o } as never)
  return id
}

describe('distillSkill', () => {
  it('extraction input carries the diff from the first reviewed head, capped at MAX_INPUT_BYTES with the findings kept', async () => {
    const id = await seedWithPr('FIXLINE '.repeat(20_000))
    await lib.distillSkill(payload, id)
    const sent = extractBodies[0]!
    expect(sent).toContain('Diff from the first reviewed head to the merged head')
    expect(sent).toContain('+FIXLINE')
    expect(sent).toContain('no test')
    expect(sent).not.toContain('Changed files:')
    expect(Buffer.byteLength(JSON.parse(sent).messages[0].content)).toBeLessThan(lib.MAX_INPUT_BYTES + 2000)
  })


  it('reviewRounds=0 and no later fix: no row and no model call', async () => {
    const { id } = await seed(0)
    expect(await lib.distillSkill(payload, id)).toBe('ineligible')
    expect(await proposals(id)).toEqual([])
    expect(calls).toEqual([])
  })

  it('reviewRounds=1: one PR on bauherr/<run-id> with the skill, its evals and an Evidence section; status replayed', async () => {
    const { id } = await seed(1)
    expect(await lib.distillSkill(payload, id)).toBe('replayed')
    const [p] = await proposals(id)
    expect(p).toMatchObject({ status: 'replayed', skillPath: 'workspace/skills/tdd-first/SKILL.md', score: 1, baselineScore: 0 })
    const run = (await payload.findByID({ collection: 'runs', id: p!.run, depth: 0, ...o })) as Record<string, any>
    expect(run).toMatchObject({ stage: 'distill', status: 'succeeded' })
    const prs = await knowledgePrs()
    expect(prs).toHaveLength(1)
    expect(prs[0]).toMatchObject({ head: `bauherr/${run.id}`, state: 'open', number: p!.pr })
    expect(prs[0]!.body).toContain('## Evidence')
    expect((await forge().getFile(REPO, 'workspace/skills/tdd-first/SKILL.md', prs[0]!.head)).content).toBe(SKILL)
    expect((await forge().getFile(REPO, 'workspace/skills/tdd-first/evals/distilled.yaml', prs[0]!.head)).content).toContain('"id": "a"')
    expect(calls.map((c) => c.kind)).toEqual(['extract', 'subject', 'subject', 'subject', 'subject'])
  })

  it('scores below the thresholds: rejected, the PR is closed with a comment', async () => {
    stub.skilledOutput = 'just code'
    const { id } = await seed(1)
    expect(await lib.distillSkill(payload, id)).toBe('rejected')
    const [p] = await proposals(id)
    expect(p).toMatchObject({ status: 'rejected', score: 0 })
    const [pr] = await knowledgePrs()
    expect(pr!.state).toBe('closed')
    expect((await forge().listPullRequestComments(REPO, pr!.number)).map((c) => c.body).join()).toContain('Rejected')
    expect(count('subject')).toBe(2 + 4)
  })

  it('a duplicate call produces one row, one PR and no further model call; queueing twice queues one job', async () => {
    const { id } = await seed(1)
    expect(await lib.distillSkill(payload, id)).toBe('replayed')
    const made = calls.length
    expect(await lib.distillSkill(payload, id)).toBe('exists')
    expect(await proposals(id)).toHaveLength(1)
    expect(await knowledgePrs()).toHaveLength(1)
    expect(calls).toHaveLength(made)
    const { id: other } = await seed(1)
    const t = (await payload.findByID({ collection: 'tickets', id: other, depth: 0, ...o })) as Record<string, any>
    await lib.queueDistill(payload, t)
    await lib.queueDistill(payload, t)
    expect(await payload.count({ collection: 'payload-jobs' as never, where: { concurrencyKey: { equals: `distill:${other}` } } as never, ...o })).toMatchObject({ totalDocs: 1 })
  })

  it('a budget abort and the daily cap end as skipped with the call counts asserted', async () => {
    stub.usage = { input_tokens: 400_000, output_tokens: 50 }
    const { id } = await seed(1)
    expect(await lib.distillSkill(payload, id)).toBe('skipped')
    expect((await proposals(id))[0]).toMatchObject({ status: 'skipped', reason: expect.stringContaining('budget') })
    expect(calls.map((c) => c.kind)).toEqual(['extract'])
    expect(await knowledgePrs()).toEqual([])

    calls.length = 0
    stub.usage = { input_tokens: 100, output_tokens: 50 }
    const first = await seed(1)
    for (let i = 0; i < lib.DAILY_CAP; i++) await payload.create({ collection: 'skill_proposals', data: { ticket: (await seed(0, first.ws)).id, workspace: first.ws, status: 'skipped' }, ...o } as never)
    expect(await lib.distillSkill(payload, first.id)).toBe('skipped')
    expect((await proposals(first.id))[0]).toMatchObject({ status: 'skipped', reason: 'budget: daily cap' })
    expect(calls).toEqual([])
  })

  it('watchKnowledgePrs ignores the distillation PR even with green checks', async () => {
    const { id } = await seed(1)
    expect(await lib.distillSkill(payload, id)).toBe('replayed')
    const [pr] = await knowledgePrs()
    backend.current.setChecks(REPO, pr!.headSha, [{ name: 'lint', status: 'completed', conclusion: 'success' }])
    const { watchKnowledgePrs } = await import('../src/lib/knowledge-edit')
    expect(await watchKnowledgePrs(payload)).toBe(0)
    expect((await forge().getPullRequest(REPO, pr!.number)).state).toBe('open')
  })

  describe('approveSkillProposal', () => {
    const approveSkillProposal: typeof import('../src/lib/actions').approveSkillProposal = (...a) => import('../src/lib/actions').then((m) => m.approveSkillProposal(...a))
    const adminOf = async (ws: number) => (await payload.create({ collection: 'bauherren', data: { email: `admin${++seq}@x.io`, password: 'pw-123456', role: 'admin', tenants: [{ tenant: ws }] }, ...o } as never)) as Record<string, any>
    const proposed = async () => {
      const { id, ws } = await seed(1)
      await lib.distillSkill(payload, id)
      const [p] = await proposals(id)
      const pr = await forge().getPullRequest(REPO, Number(p!.pr))
      return { p: p!, pr, user: await adminOf(ws), ws }
    }

    it('refuses an agent key (the tool is human-only, nothing merges)', async () => {
      const { p, pr, user } = await proposed()
      const { callTool } = await import('../src/lib/mcp-tools')
      const keys = await import('../src/lib/api-key')
      const agent = { kind: 'agent' as const, keyId: (await keys.resolveAgentKey(payload, await keys.mintAgentKey(payload, user as never, 'laptop')))!.keyId }
      await expect(callTool({ payload, user: user as never, actor: agent }, 'approve_skill_proposal', { proposal: p.id, expectSha: pr.headSha })).rejects.toThrow('forbidden: approve_skill_proposal needs a human')
      expect((await forge().getPullRequest(REPO, pr.number)).state).toBe('open')
      expect((await proposals(Number(p.ticket)))[0]!.status).toBe('replayed')
    })

    it('refuses a head that moved since it was reviewed', async () => {
      const { p, pr, user } = await proposed()
      backend.current.commit(REPO, pr.head, 'workspace/skills/tdd-first/extra.md', 'moved\n')
      await expect(approveSkillProposal(payload, user, { proposal: p.id, expectSha: pr.headSha })).rejects.toThrow('head moved')
      expect((await forge().getPullRequest(REPO, pr.number)).state).toBe('open')
      expect((await proposals(Number(p.ticket)))[0]!.status).toBe('replayed')
    })

    it('with a human Admin: merges the PR, sets accepted, and refuses a second approval and a non-admin', async () => {
      const { p, pr, user, ws } = await proposed()
      const member = (await payload.create({ collection: 'bauherren', data: { email: `m${++seq}@x.io`, password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o } as never)) as Record<string, any>
      await expect(approveSkillProposal(payload, member, { proposal: p.id, expectSha: pr.headSha })).rejects.toThrow('Only an Admin')
      expect(await approveSkillProposal(payload, user, { proposal: p.id, expectSha: pr.headSha })).toEqual({ approved: 'accepted' })
      expect((await forge().getPullRequest(REPO, pr.number)).state).toBe('merged')
      expect((await proposals(Number(p.ticket)))[0]!.status).toBe('accepted')
      await expect(approveSkillProposal(payload, user, { proposal: p.id, expectSha: pr.headSha })).rejects.toThrow('is accepted')
    })
  })
})
