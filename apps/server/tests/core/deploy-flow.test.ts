import { sql } from '@payloadcms/db-postgres'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decide } from '../../src/core/decide'
import { openPullsAt } from '../../src/core/hooks/store'
import { readEvents } from '../../src/core/record/store'
import { REASON_WORDS } from '../../src/app/(app)/lib/ticket-words'
import { ticket } from '../../src/core/views/ticket'
import { BRIEF, flowHarness, type Flow } from './modules-harness'

const f = flowHarness('core_deploy_flow')
const MINUTE = 60_000

beforeEach(async () => {
  await f.product(sql`"deploy_checks" = 'deploy', "deploy_wait_minutes" = 60`)
})

type Verifying = Awaited<ReturnType<Flow['toVerify']>>

const owner = () => ({ id: 'u7', role: 'bauherr', workspaceIds: [f.h.ids.workspace] })

const pass = async (s: Verifying) => {
  const proofs = await Promise.all(['c1', 'c2', 'c3'].map((c) => f.proof(s.id, c)))
  const criteria = ['c1', 'c2', 'c3'].map((id, i) => ({ id, status: 'met', proof: [proofs[i]] }))
  const result = {
    headSha: s.pull.headSha,
    patchId: 'p1',
    criteria,
    findings: [],
    verdict: 'pass',
    changes: [],
    walkthrough: [],
    notVerified: [],
  }
  await f.work(s.id, 'verifier', result)
}

const mergedAt = async (s: Verifying): Promise<string> => {
  const merged = (await readEvents(f.h.payload(), s.id)).findLast((event) => event.type === 'ship.merged')
  if (merged?.type !== 'ship.merged') throw new Error('not merged')
  return merged.data.sha
}

const waitingOnDeploy = async () => {
  const s = await f.toVerify()
  await pass(s)
  return { s, sha: await mergedAt(s) }
}

const deployCheck = (conclusion: string) => [{ name: 'deploy', status: 'completed', conclusion }]

const count = async (id: number, type: string) => (await f.types(id)).filter((t) => t === type).length

const answer = async (id: number, choice: string) => {
  const seq = (await f.view(id)).card?.seq ?? -1
  await decide(id, owner(), { ask: 'question:deploy-stalled', choice, seq }, f.subDeps())
}

describe('the deploy after a merge, against the fake forge', () => {
  it('waits on the deploy, then asks for the result once the check on the merge commit succeeds', async () => {
    const { s, sha } = await waitingOnDeploy()
    expect(await f.view(s.id)).toMatchObject({ stage: 'ship', waitingOn: 'agents', card: null })
    await s.sync()
    expect(await f.view(s.id)).toMatchObject({ stage: 'ship', waitingOn: 'agents' })
    expect(await f.types(s.id)).not.toContain('ship.deployed')

    f.fake().setChecks(s.repo, sha, deployCheck('success'))
    await s.sync()
    expect(await f.types(s.id)).toContain('ship.deployed')
    expect(await f.view(s.id)).toMatchObject({ stage: 'ship', waitingOn: 'owner', card: { card: 'result' } })
    await s.sync()
    expect(await count(s.id, 'ship.deployed')).toBe(1)

    const seq = (await f.view(s.id)).card?.seq ?? -1
    await decide(s.id, owner(), { ask: 'result', choice: 'accept', seq }, f.subDeps())
    expect(await f.view(s.id)).toMatchObject({ stage: 'done', waitingOn: 'nobody' })
  })

  it('asks once about a failed deploy check, checks again, and goes on after a successful re-run', async () => {
    const { s, sha } = await waitingOnDeploy()
    f.fake().setChecks(s.repo, sha, deployCheck('failure'))
    await s.sync()
    expect(await f.view(s.id)).toMatchObject({
      stage: 'ship',
      waitingOn: 'owner',
      card: { card: 'question', reason: 'deploy-stalled', options: ['check-again', 'continue'] },
    })
    await s.sync()
    expect(await count(s.id, 'ship.deploy-stalled')).toBe(1)
    expect(await count(s.id, 'question.asked')).toBe(1)
    const view = await ticket(f.h.payload(), { workspace: f.h.ids.workspace, recordId: s.id })
    expect(view.deploy).toMatchObject({ reason: 'failed', checks: ['deploy'] })
    expect(view.deploy?.url).toContain(`/commit/${sha}/checks`)
    expect(REASON_WORDS['deploy-stalled']).toMatch(/\S/)

    await answer(s.id, 'check-again')
    expect(await f.view(s.id)).toMatchObject({ stage: 'ship', waitingOn: 'agents', card: null })
    await s.sync()
    await s.sync()
    expect(await count(s.id, 'ship.deploy-stalled')).toBe(1)
    expect(await f.view(s.id)).toMatchObject({ waitingOn: 'agents', card: null })

    f.fake().setChecks(s.repo, sha, deployCheck('success'))
    await s.sync()
    expect(await count(s.id, 'ship.deployed')).toBe(1)
    expect(await f.view(s.id)).toMatchObject({ stage: 'ship', waitingOn: 'owner', card: { card: 'result' } })
    const statements = await f.h.rows(sql`SELECT "kind", "text" FROM "statements" WHERE "record_id" = ${s.id}`)
    expect(statements).toHaveLength(1)
  })

  it('raises a later failure of the re-run as a new fact', async () => {
    const { s, sha } = await waitingOnDeploy()
    f.fake().setChecks(s.repo, sha, deployCheck('failure'))
    await s.sync()
    await answer(s.id, 'check-again')
    f.fake().setChecks(s.repo, sha, [{ name: 'deploy', status: 'completed', conclusion: 'cancelled' }])
    await s.sync()
    expect(await count(s.id, 'ship.deploy-stalled')).toBe(2)
    expect(await f.view(s.id)).toMatchObject({ waitingOn: 'owner', card: { reason: 'deploy-stalled' } })
  })

  it('counts the change as deployed when the owner says so', async () => {
    const { s, sha } = await waitingOnDeploy()
    f.fake().setChecks(s.repo, sha, deployCheck('failure'))
    await s.sync()
    await answer(s.id, 'continue')
    const types = await f.types(s.id)
    expect(types.slice(-2)).toEqual(['question.answered', 'ship.deployed'])
    expect(await f.view(s.id)).toMatchObject({ stage: 'ship', waitingOn: 'owner', card: { card: 'result' } })
  })

  it('asks when no check arrived within the limit, not one minute before', async () => {
    const { s } = await waitingOnDeploy()
    f.clock.now = new Date(Date.now() + 59 * MINUTE)
    await s.sync()
    expect(await count(s.id, 'ship.deploy-stalled')).toBe(0)
    f.clock.now = new Date(Date.now() + 61 * MINUTE)
    await s.sync()
    const stalled = (await readEvents(f.h.payload(), s.id)).filter((e) => e.type === 'ship.deploy-stalled')
    expect(stalled.map((e) => e.data)).toEqual([{ reason: 'overdue', checks: ['deploy'] }])
    expect(await f.view(s.id)).toMatchObject({ waitingOn: 'owner', card: { reason: 'deploy-stalled' } })
    await s.sync()
    expect(await count(s.id, 'ship.deploy-stalled')).toBe(1)

    await answer(s.id, 'check-again')
    f.clock.now = new Date(Date.now() + 59 * MINUTE)
    await s.sync()
    expect(await count(s.id, 'ship.deploy-stalled')).toBe(1)
    f.clock.now = new Date(Date.now() + 61 * MINUTE)
    await s.sync()
    expect(await count(s.id, 'ship.deploy-stalled')).toBe(2)
  })
})

describe('an adopted pull request', () => {
  it('waits on the deploy after the owner accepted and the merge, and stalls the same way', async () => {
    const s = await f.startAdopted('active')
    await f.work(s.id, 'builder', BRIEF)
    await s.sync()
    f.green(s.repo, s.headSha)
    await s.sync()
    const proofs = await Promise.all(['c1', 'c2', 'c3'].map((c) => f.proof(s.id, c)))
    const criteria = ['c1', 'c2', 'c3'].map((id, i) => ({ id, status: 'met', proof: [proofs[i]] }))
    const verdict = { headSha: s.headSha, patchId: `adopted:${s.headSha}`, criteria, findings: [], verdict: 'pass' }
    await f.work(s.id, 'verifier', { ...verdict, changes: [], walkthrough: [], notVerified: [] })
    expect(await f.view(s.id)).toMatchObject({ stage: 'ship', waitingOn: 'owner', card: { card: 'result' } })
    const seq = (await f.view(s.id)).card?.seq ?? -1
    await decide(s.id, owner(), { ask: 'result', choice: 'accept', seq }, f.subDeps())
    expect(await f.view(s.id)).toMatchObject({ stage: 'ship', waitingOn: 'agents' })
    const merged = (await readEvents(f.h.payload(), s.id)).findLast((event) => event.type === 'ship.merged')
    const sha = merged?.type === 'ship.merged' ? merged.data.sha : ''

    f.fake().setChecks(s.repo, sha, deployCheck('failure'))
    await s.sync()
    expect(await f.view(s.id)).toMatchObject({ waitingOn: 'owner', card: { reason: 'deploy-stalled' } })
    await answer(s.id, 'check-again')
    f.fake().setChecks(s.repo, sha, deployCheck('success'))
    await s.sync()
    expect(await f.view(s.id)).toMatchObject({ stage: 'done', waitingOn: 'nobody' })
  })
})

describe('which merge commits the sync reads', () => {
  it('reads the checks of the merge commit only while a ticket waits on its deploy', async () => {
    const { s, sha } = await waitingOnDeploy()
    const listChecks = vi.spyOn(f.fake().forge, 'listChecks')
    const reads = () => listChecks.mock.calls.filter(([, at]) => at === sha).length
    await s.sync()
    expect(reads()).toBe(1)
    f.fake().setChecks(s.repo, sha, deployCheck('success'))
    await s.sync()
    expect(reads()).toBe(2)
    await s.sync()
    await s.sync()
    expect(reads()).toBe(2)
    listChecks.mockRestore()
  })

  it('reads none for a Product without deploy checks', async () => {
    await f.product(sql`"deploy_checks" = NULL`)
    const s = await f.toVerify()
    await pass(s)
    const sha = await mergedAt(s)
    const listChecks = vi.spyOn(f.fake().forge, 'listChecks')
    await s.sync()
    await s.sync()
    expect(listChecks.mock.calls.filter(([, at]) => at === sha)).toHaveLength(0)
    expect(await f.view(s.id)).toMatchObject({ stage: 'ship', waitingOn: 'owner', card: { card: 'result' } })
    listChecks.mockRestore()
  })

  it('lets a delivery for the merge commit resolve to the pull request of a ticket waiting on its deploy', async () => {
    const { s, sha } = await waitingOnDeploy()
    const [source] = await f.h.rows(sql`SELECT "id" FROM "ticket_sources" WHERE "repo" = ${s.repo}`)
    const head = { repo: s.repo, sha }
    const items = await openPullsAt(f.h.payload(), Number(source?.id), head)
    expect(items).toEqual([{ repo: s.repo, kind: 'pr', number: s.pull.number }])
    f.fake().setChecks(s.repo, sha, deployCheck('success'))
    await s.sync()
    expect(await openPullsAt(f.h.payload(), Number(source?.id), head)).toEqual([])
  })
})
