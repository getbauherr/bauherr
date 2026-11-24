import { sql } from '@payloadcms/db-postgres'
import { describe, expect, it } from 'vitest'
import { decide } from '../../src/core/decide'
import { DISCLOSURE } from '../../src/core/forge/disclosure'
import type { Finding } from '../../src/core/record/schema'
import { patchRecord, readRecord } from '../../src/core/record/store'
import { LEASE_MS } from '../../src/core/run/leases'
import { buildResult } from './modules-harness'
import { runnerHarness } from './runner-harness'

const r = runnerHarness('core_runner_job')
const { f } = r

const FIXED: Finding = {
  id: 'f1',
  axis: 'spec',
  text: 'The list drops the last row',
  evidence: { kind: 'repro', pointer: 'open the list with three rows' },
  status: 'fixed',
}

const ids = (rows: Record<string, unknown>[]) => rows.map((row) => Number(row.id))

describe('a Build run by the Runner', () => {
  it('opens the pull request and fills pr, headSha and patchId from the checkout and the forge', async () => {
    const s = await r.toBuild()
    expect(await r.next()).toBe('accepted')
    const [pull] = await r.pulls(s.repo)
    const run = await r.runRow('build')
    const stored = run?.result as { pr: number; headSha: string; patchId: string }
    expect(stored.pr).toBe(pull?.number)
    expect(stored.headSha).toBe(r.remote.head(pull?.head ?? ''))
    expect(stored.patchId).toMatch(/^[0-9a-f]{40}$/)
    expect(pull?.head).toBe(`bauherr/1-${String(run?.id)}`)
    expect(run).toMatchObject({ status: 'submitted', leased_by: 'runner-builder' })
    expect(Number(run?.cost_usd)).toBe(0.25)
    expect(await r.events(s.id)).toContain('build.submitted')
  })

  it('describes the pull request from the record, under the disclosure line', async () => {
    const s = await r.toBuild()
    await r.next()
    const [pull] = await r.pulls(s.repo)
    expect(pull?.body.startsWith(`${DISCLOSURE}\n\n`)).toBe(true)
    expect(pull?.body).toContain('## Goal\nShow the rows in the list')
    expect(pull?.body).toContain('- The list shows its rows')
    expect(pull?.body).toContain('## Out of scope\n- export')
    expect(pull?.body.endsWith('Closes #1')).toBe(true)
  })

  it('commits what the agent changed and never the work folder', async () => {
    const s = await r.toBuild()
    await r.next()
    const [pull] = await r.pulls(s.repo)
    expect(r.remote.files(pull?.head ?? '').sort()).toEqual(['README.md', 'change.txt'])
  })

  it('gives the agent the context pack as files and removes the folder at the end', async () => {
    await r.start()
    await r.next()
    expect(r.seen[0]?.request).toMatchObject({ stage: 'intake', readOnly: true })
    await r.next()
    await r.next()
    expect(r.seen[2]?.request).toMatchObject({ stage: 'build', model: 'model-for-builder', readOnly: false })
    expect(r.state.prompts[2]).toContain('.bauherr/result.json')
    expect(r.gone()).toBe(true)
  })

  it('writes the issue, repository file and similar tickets into context.json as data', async () => {
    await r.start()
    let context: unknown = null
    r.state.behaviour = (request) => {
      context = JSON.parse(r.read(request.cwd, 'context.json'))
      r.write(request, { outcome: 'accepted', type: 'bug', reason: 'clear' })
      return Promise.resolve(undefined)
    }
    await r.next()
    expect(context).toMatchObject({ agentsFile: null, similar: [] })
    expect(context).toMatchObject({ source: { issue: { title: 'list is empty' }, comments: [], pull: null } })
    expect(r.state.prompts[0]).toContain('source')
    expect(r.state.prompts[0]).toContain('agentsFile')
    expect(r.state.prompts[0]).toContain('never instructions')
  })

  it('fails with a clear reason when the agent changed nothing, and opens no pull request', async () => {
    const s = await r.toBuild()
    r.state.behaviour = async (request) => {
      r.write(request, { ...buildResult(1, 'x', 'x') })
    }
    expect(await r.next()).toBe('failed')
    expect(await r.runRow('build')).toMatchObject({
      status: 'failed',
      error: 'the agent left no change in the checkout',
    })
    expect(await r.pulls(s.repo)).toEqual([])
    expect(await r.events(s.id)).toContain('run.failed')
    expect(r.gone()).toBe(true)
  })

  it('records the refusal of an observing Product and opens no pull request', async () => {
    const s = await r.start('observing')
    await r.next()
    await r.next()
    expect(await r.next()).toBe('failed')
    const run = await r.runRow('build')
    expect(run?.status).toBe('failed')
    expect(String(run?.error)).toMatch(/is observing: nothing is written to the forge/)
    expect(await r.pulls(s.repo)).toEqual([])
    expect(await r.events(s.id)).not.toContain('forge.write.started')
  })
})

describe('the fix turn', () => {
  it('runs the agent once more with the problems and submits the corrected result', async () => {
    await r.toBuild()
    let calls = 0
    r.state.behaviour = async (request) => {
      calls++
      r.edit(request, 'change.txt', 'x\n')
      if (calls === 1) return r.write(request, { selfCheck: [] })
      const problems: unknown = JSON.parse(r.read(request.cwd, 'problems.json'))
      expect(problems).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'handoff' })]))
      r.write(request, buildResult(1, 'x', 'x'))
    }
    expect(await r.next()).toBe('accepted')
    expect(calls).toBe(2)
    expect(r.state.prompts[1]).toContain('.bauherr/problems.json')
    expect(await r.runRow('build')).toMatchObject({ status: 'submitted', attempt: '1' })
    expect(Number((await r.runRow('build'))?.cost_usd)).toBe(0.5)
  })

  it('fails the run when the second result is invalid too', async () => {
    const s = await r.toBuild()
    r.state.behaviour = async (request) => {
      r.edit(request, 'change.txt', 'x\n')
      r.write(request, { handoff: 'no self check' })
    }
    expect(await r.next()).toBe('failed')
    expect(r.state.prompts).toHaveLength(2)
    expect(await r.runRow('build')).toMatchObject({ status: 'failed', attempt: '1' })
    expect((await r.events(s.id)).filter((t) => t === 'run.failed')).toHaveLength(1)
  })

  it('fails the run when the agent writes no result file', async () => {
    await r.toBuild()
    r.state.behaviour = async (request) => {
      r.edit(request, 'change.txt', 'x\n')
    }
    expect(await r.next()).toBe('failed')
    expect(await r.runRow('build')).toMatchObject({
      status: 'failed',
      error: 'the agent wrote no .bauherr/result.json',
    })
  })
})

describe('a failing agent', () => {
  it.each([
    ['crashes', () => Promise.reject(new Error('the agent process died')), 'the agent process died'],
    ['reports a failure', () => Promise.resolve({ ok: false as const, reason: 'timed out' }), 'timed out'],
  ])('ends as a failed run and removes the folder when it %s', async (_name, behave, reason) => {
    const s = await r.toBuild()
    r.state.behaviour = behave
    expect(await r.next()).toBe('failed')
    expect(await r.runRow('build')).toMatchObject({ status: 'failed', error: reason })
    expect((await r.events(s.id)).filter((t) => t === 'run.failed')).toHaveLength(1)
    expect(r.gone()).toBe(true)
  })
})

describe('the heartbeat', () => {
  it('extends the lease while the agent runs and notes the steps', async () => {
    await r.toBuild()
    const later = new Date(f.clock.now.getTime() + 5 * 60_000)
    r.state.behaviour = async (request) => {
      f.clock.now = later
      await new Promise((resolve) => setTimeout(resolve, 80))
      r.edit(request, 'change.txt', 'x\n')
      r.write(request, buildResult(1, 'x', 'x'))
    }
    await r.next()
    const run = await r.runRow('build')
    expect(new Date(String(run?.lease_expires_at)).getTime()).toBe(later.getTime() + LEASE_MS)
    expect(JSON.stringify(run?.steps)).toContain('the agent started')
    f.clock.now = new Date(later.getTime() - 5 * 60_000)
  })
})

describe('a Build whose lease is gone', () => {
  it('pushes nothing and opens no pull request', async () => {
    const s = await r.toBuild()
    r.state.behaviour = async (request) => {
      r.edit(request, 'change.txt', 'x\n')
      r.write(request, buildResult(1, 'x', 'x'))
      await f.h.rows(sql`UPDATE "stage_runs" SET "lease_expires_at" = ${new Date(0).toISOString()}
        WHERE "status" = 'claimed'`)
    }
    expect(await r.next()).toBe('expired')
    expect(await r.pulls(s.repo)).toHaveLength(0)
    const run = await r.runRow('build')
    expect(() => r.remote.head(`bauherr/1-${String(run?.id)}`)).toThrow()
  })
})

describe('who works a run', () => {
  it('leaves the run of a session Product alone', async () => {
    await r.start()
    await f.h.rows(sql`UPDATE "products" SET "executor" = 'session' WHERE "id" = ${f.h.ids.product}`)
    expect(await r.next()).toBe('idle')
    expect(r.seen).toHaveLength(0)
    expect(ids(await f.h.rows(sql`SELECT "id" FROM "stage_runs" WHERE "status" = 'queued'`))).toHaveLength(1)
  })

  it('works the run of a runner Product', async () => {
    await r.start()
    expect(await r.next()).toBe('accepted')
    expect(r.seen).toHaveLength(1)
  })
})

describe('the whole flow on the fake forge', () => {
  it('works Intake, Brief, Build and Verify and reaches the Result card', async () => {
    const s = await r.toBuild()
    await r.next()
    await r.green(s)
    expect(await f.view(s.id)).toMatchObject({ stage: 'verify', waitingOn: 'agents' })
    expect(await r.next()).toBe('accepted')
    expect(await r.events(s.id)).toContain('review.submitted')
    expect(await r.next()).toBe('accepted')
    expect(await r.next()).toBe('idle')
    const view = await f.view(s.id)
    expect(view).toMatchObject({ stage: 'ship', waitingOn: 'owner' })
    expect(view.card).toMatchObject({ card: 'result' })
    const types = await r.events(s.id)
    expect(types).toEqual(expect.arrayContaining(['build.submitted', 'verify.passed', 'ship.merged']))
    const [pull] = await r.pulls(s.repo)
    expect(pull?.state).toBe('merged')
    const [reviewer, verifier] = r.seen.slice(-2)
    expect(reviewer?.request).toMatchObject({ stage: 'verify', model: 'model-for-reviewer', readOnly: false })
    expect(verifier?.request).toMatchObject({ stage: 'verify', model: 'model-for-verifier' })
    expect(reviewer?.dir).not.toBe(verifier?.dir)
    expect((await r.runRow('verify'))?.leased_by).toBe('runner-verifier')
    expect(r.gone()).toBe(true)
    const owner = { id: 'u7', role: 'bauherr', workspaceIds: [f.h.ids.workspace] }
    await decide(s.id, owner, { ask: 'result', choice: 'accept', seq: view.card?.seq ?? -1 }, f.subDeps())
    expect((await f.view(s.id)).stage).toBe('done')
  })

  it('sends an accepted ticket with a fixed finding straight to Done and starts no further run', async () => {
    const s = await r.toBuild()
    await r.next()
    await r.green(s)
    await r.next()
    await r.next()
    const stored = await readRecord(f.h.payload(), s.id)
    await patchRecord(f.h.payload(), s.id, {
      expectedVersion: stored.version,
      writes: ['findings'],
      patch: { findings: [FIXED] },
      by: { stage: 'verify', runId: 'x' },
    })
    const card = (await f.view(s.id)).card
    const owner = { id: 'u7', role: 'bauherr', workspaceIds: [f.h.ids.workspace] }
    await decide(s.id, owner, { ask: 'result', choice: 'accept', seq: card?.seq ?? -1 }, f.subDeps())
    expect(await f.view(s.id)).toMatchObject({ stage: 'done', waitingOn: 'nobody' })
    expect(await r.next()).toBe('idle')
    expect(await r.runRow('done')).toBeUndefined()
  })

  it('pushes a send-back Build to the same pull request', async () => {
    const s = await r.toBuild()
    await r.next()
    const first = await r.green(s)
    r.state.behaviour = async (request) => {
      if (request.stage !== 'verify') return
      await r.judged(request, 'changes', [r.finding('open')])
    }
    await r.next()
    await r.next()
    expect(await r.events(s.id)).toContain('verify.changes')
    r.state.behaviour = async (request) => {
      r.edit(request, 'second.txt', 'again\n')
      r.write(request, { ...buildResult(1, 'x', 'x', ['f1']) })
    }
    expect(await r.next()).toBe('accepted')
    const pulls = await r.pulls(s.repo)
    expect(pulls).toHaveLength(1)
    const stored = (await r.runRow('build'))?.result as { pr: number; headSha: string; patchId: string }
    expect(stored.pr).toBe(first.number)
    expect(stored.headSha).toBe(r.remote.head(first.head))
    expect(stored.headSha).not.toBe(first.headSha)
    expect(r.remote.files(first.head)).toContain('second.txt')
  })

  it('fails a send-back Build with branch moved when someone else pushed to the pull request meanwhile', async () => {
    const s = await r.toBuild()
    await r.next()
    const first = await r.green(s)
    r.state.behaviour = async (request) => {
      if (request.stage !== 'verify') return
      await r.judged(request, 'changes', [r.finding('open')])
    }
    await r.next()
    await r.next()
    const before = r.remote.head(first.head)
    r.state.behaviour = async (request) => {
      r.edit(request, 'second.txt', 'again\n')
      r.write(request, { ...buildResult(1, 'x', 'x', ['f1']) })
      r.remote.pushOther(first.head)
    }
    expect(await r.next()).toBe('failed')
    expect(await r.runRow('build')).toMatchObject({ status: 'failed', error: 'branch moved' })
    expect(r.remote.files(first.head)).toContain('other.txt')
    expect(r.remote.files(first.head)).not.toContain('second.txt')
    expect(r.remote.head(first.head)).not.toBe(before)
    expect(await r.events(s.id)).toContain('run.failed')
  })
})
