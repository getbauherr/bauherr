import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from '@payloadcms/db-postgres'
import { beforeEach } from 'vitest'
import { createWriter } from '../../src/core/forge/writer'
import { readEvents } from '../../src/core/record/store'
import { workNext } from '../../src/jobs/runner'
import type { AgentOutcome, AgentRequest, RepoAccess, RunnerDeps } from '../../src/jobs/runner/types'
import { BRIEF, buildResult, finding, flowHarness } from './modules-harness'

const GIT_ENV = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
}

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, ...GIT_ENV } })
    .toString()
    .trim()

export type Remote = {
  baseUrl: string
  bare: string
  head: (branch: string) => string
  files: (branch: string) => string[]
  pushOther: (branch: string) => void
}

export const makeRemote = (): Remote => {
  const root = mkdtempSync(join(tmpdir(), 'bauherr-remote-'))
  const bare = join(root, 'o/n.git')
  const work = join(root, 'work')
  mkdirSync(work)
  git(root, 'init', '--bare', '-b', 'main', bare)
  git(work, 'init', '-b', 'main')
  writeFileSync(join(work, 'README.md'), 'hello\n')
  git(work, 'add', '-A')
  git(work, 'commit', '-m', 'init')
  git(work, 'push', bare, 'main')
  return {
    baseUrl: `file://${root}`,
    bare,
    head: (branch) => git(bare, 'rev-parse', `refs/heads/${branch}`),
    files: (branch) => git(bare, 'ls-tree', '-r', '--name-only', branch).split('\n'),
    pushOther: (branch) => {
      const other = join(root, 'other')
      git(root, 'clone', '-q', '--branch', branch, bare, other)
      writeFileSync(join(other, 'other.txt'), 'someone else\n')
      git(other, 'add', '-A')
      git(other, 'commit', '-m', 'other')
      git(other, 'push', '-q', 'origin', branch)
    },
  }
}

export type Seen = { request: AgentRequest; dir: string }
export type Behaviour = (request: AgentRequest) => Promise<AgentOutcome | void>

const WRONG = { pr: 999, headSha: 'wrong', patchId: 'wrong' }

export const runnerHarness = (suite: string) => {
  const f = flowHarness(suite)
  const remote = makeRemote()
  const seen: Seen[] = []
  const state: { behaviour: Behaviour | null; record: number; prompts: string[]; access: RepoAccess | null } = {
    behaviour: null,
    access: null,
    record: 0,
    prompts: [],
  }

  const write = (request: AgentRequest, result: unknown) =>
    writeFileSync(join(request.cwd, '.bauherr/result.json'), JSON.stringify(result))

  const proofs = async (): Promise<string[]> => {
    const ids: string[] = []
    for (const criterion of ['c1', 'c2', 'c3']) ids.push(await f.proof(state.record, criterion))
    return ids
  }

  const verified = async (request: AgentRequest, verdict: string, findings: unknown[] = []) => {
    const ids = await proofs()
    const criteria = ids.map((id, i) => ({ id: `c${i + 1}`, status: 'met', proof: [id] }))
    write(request, { ...WRONG, criteria, findings, verdict, changes: [], walkthrough: [], notVerified: [] })
  }

  const edit = (request: AgentRequest, file: string, content: string) =>
    writeFileSync(join(request.cwd, file), content)

  const standard: Behaviour = async (request) => {
    if (request.stage === 'intake') write(request, { outcome: 'accepted', type: 'bug', reason: 'clear' })
    if (request.stage === 'brief') write(request, BRIEF)
    if (request.stage === 'build') {
      edit(request, 'change.txt', `change for ${request.runId}\n`)
      write(request, { ...buildResult(1, 'x', 'x'), ...WRONG })
    }
    if (request.stage === 'verify') await verified(request, 'pass')
  }

  const agent = async (request: AgentRequest): Promise<AgentOutcome> => {
    seen.push({ request, dir: request.cwd })
    state.prompts.push(request.prompt)
    const outcome = await (state.behaviour ?? standard)(request)
    return outcome ?? { ok: true, costUsd: 0.25 }
  }

  const deps = (): RunnerDeps => ({
    engine: () => ({ ...f.subDeps(), skills: (stage) => Promise.resolve(`# skill for ${stage}`) }),
    writer: createWriter(f.h.payload(), { backend: async () => f.fake(), now: () => f.clock.now }),
    access: () =>
      Promise.resolve(
        state.access ?? {
          baseUrl: remote.baseUrl,
          repo: 'o/n',
          defaultBranch: 'main',
          token: () => Promise.resolve('secret'),
        },
      ),
    model: (_workspace, role) => Promise.resolve(`model-for-${role}`),
    agent,
    beatMs: 10,
  })

  const start = async (state_: 'active' | 'observing' = 'active') => {
    const s = await f.start(state_)
    const forge = f.fake().forge
    const open = forge.openPullRequest.bind(forge)
    forge.openPullRequest = async (repo, pr) => {
      const pull = await open(repo, pr)
      pull.headSha = remote.head(pr.head)
      return pull
    }
    const merge = forge.mergePullRequest.bind(forge)
    forge.mergePullRequest = (repo, number, options) => merge(repo, number, { method: options.method })
    await f.h.rows(sql`UPDATE "products" SET "executor" = 'runner' WHERE "id" = ${f.h.ids.product}`)
    return s
  }

  const next = () => workNext(deps())

  const toBuild = async () => {
    const s = await start()
    state.record = s.id
    await next()
    await next()
    seen.length = 0
    state.prompts = []
    return s
  }

  const runRow = async (stage: string) =>
    (
      await f.h.rows(sql`SELECT * FROM "stage_runs" WHERE "stage" = ${stage} AND "status" <> 'queued'
        ORDER BY "id" DESC LIMIT 1`)
    )[0]

  const pulls = (repo: string) => f.fake().forge.listPullRequests(repo, 'all')

  const green = async (s: { repo: string; sync: () => Promise<unknown> }) => {
    const [pull] = await pulls(s.repo)
    if (!pull) throw new Error('no pull request')
    f.green(s.repo, pull.headSha)
    await s.sync()
    await s.sync()
    return pull
  }

  const events = async (id: number) => (await readEvents(f.h.payload(), id)).map((e) => e.type)

  beforeEach(() => {
    seen.length = 0
    state.behaviour = null
    state.access = null
    state.prompts = []
  })

  const gone = () => seen.every((s) => !existsSync(s.dir))
  const read = (dir: string, file: string) => readFileSync(join(dir, '.bauherr', file), 'utf8')

  const actions = { start, next, toBuild, runRow, pulls, green, events }
  return { f, remote, seen, state, deps, ...actions, gone, read, edit, write, verified, finding }
}
