import { FakeBackend } from '@bauherr/adapters'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { checkGitlabCi, checkGitlabTrain, checkTrainTrigger, checkWorkflows, detectMergeMode, preflightQueue, preflightTrain } from '../src/lib/merge-preflight'

const wf = (on: string, jobs: string) => `name: ci\non:\n${on}\njobs:\n${jobs}\n`
const CI = '  ci:\n    runs-on: ubuntu-latest\n    steps: []'
const file = (content: string) => [{ path: '.github/workflows/ci.yml', content }]

describe('checkWorkflows', () => {
  it('flags a workflow that produces a required check without merge_group', () => {
    const problems = checkWorkflows(file(wf('  pull_request:\n  push:', CI)), ['ci'])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('no merge_group trigger')
  })

  it('flags a deploy job that would run on merge_group', () => {
    const jobs = `${CI}\n  deploy-staging:\n    runs-on: ubuntu-latest\n    steps: []`
    const problems = checkWorkflows(file(wf('  pull_request:\n  merge_group:', jobs)), ['ci'])
    expect(problems).toEqual([expect.stringContaining('job "deploy-staging" would deploy or publish on merge_group')])
  })

  it('accepts a deploy job that skips merge_group', () => {
    const jobs = `${CI}\n  deploy-staging:\n    if: github.event_name != 'merge_group'\n    runs-on: ubuntu-latest\n    steps: []`
    expect(checkWorkflows(file(wf('  pull_request:\n  merge_group:', jobs)), ['ci'])).toEqual([])
  })

  it('accepts a clean workflow set: merge_group on every workflow that produces a required check, others untouched', () => {
    const files = [
      { path: '.github/workflows/ci.yml', content: wf('  pull_request:\n  push:\n  merge_group:', CI) },
      { path: '.github/workflows/site.yml', content: wf('  push:\n    paths: [site/**]', '  site:\n    runs-on: ubuntu-latest\n    steps: []') },
      { path: '.github/workflows/release.yml', content: wf('  push:\n    tags: ["v*"]', '  release:\n    runs-on: ubuntu-latest\n    steps: []') },
    ]
    expect(checkWorkflows(files, ['ci'])).toEqual([])
  })

  it('the bauherr ci.yml fixture (a copy of .github/workflows/ci.yml) passes with merge_group and fails without', () => {
    const ci = readFileSync(new URL('./fixtures/ci.yml', import.meta.url), 'utf8')
    const required = ['check', 'test', 'build-image', 'e2e', 'e2e-fake', 'cli', 'gateway-validate', 'cli-smoke']
    expect(checkWorkflows(file(ci), required)).toEqual([])
    const problems = checkWorkflows(file(ci.replace('  merge_group:\n', '')), required)
    expect(problems.length).toBeGreaterThan(0)
    expect(problems[0]).toContain('no merge_group trigger')
  })

  it('matches matrix and reusable-workflow contexts to their job, and takes a job name over its id', () => {
    const jobs = '  e2e:\n    name: e2e shard\n    runs-on: ubuntu-latest\n    steps: []'
    expect(checkWorkflows(file(wf('  pull_request:', jobs)), ['e2e shard (2)'])).toHaveLength(1)
    expect(checkWorkflows(file(wf('  pull_request:', jobs)), ['e2e'])).toEqual([])
  })

  it('reports invalid YAML as a problem instead of throwing', () => {
    expect(checkWorkflows(file('on: [unclosed'), ['ci'])).toEqual([expect.stringContaining('not valid YAML')])
  })
})

describe('checkGitlabCi', () => {
  it('needs merge_request_event rules in the CI file itself', () => {
    expect(checkGitlabCi(null)).toEqual([expect.stringContaining('no .gitlab-ci.yml')])
    expect(checkGitlabCi('test:\n  script: [x]\n')).toEqual([expect.stringContaining('merge_request_event')])
    expect(checkGitlabCi('test:\n  script: [x]\n  rules:\n    - if: $CI_PIPELINE_SOURCE == "merge_request_event"\n')).toEqual([])
  })
})

describe('train preflight', () => {
  const ci = (on: string) => file(wf(on, CI))
  it('GitHub: a pull_request workflow needs a push trigger that covers bauherr/train, and the problem names the line to add', () => {
    for (const on of ['  pull_request:', '  pull_request:\n  push:\n    branches: [main]', '  pull_request:\n  push:\n    tags: [v*]', '  pull_request:\n  push:\n    branches-ignore: [bauherr/**]']) {
      expect(checkTrainTrigger(ci(on)), on).toEqual([expect.stringContaining('branches: [bauherr/train]')])
    }
    for (const on of ['  pull_request:\n  push:', '  pull_request:\n  push:\n    branches: [main, bauherr/*]', '  pull_request:\n  push:\n    branches: ["**"]', '  push:\n    branches: [main]']) {
      expect(checkTrainTrigger(ci(on)), on).toEqual([])
    }
  })
  it('GitLab: rules must reach the train branch', () => {
    expect(checkGitlabTrain('test:\n  script: [x]\n')).toEqual([])
    expect(checkGitlabTrain('test:\n  script: [x]\n  rules:\n    - if: $CI_COMMIT_BRANCH == "bauherr/train"\n')).toEqual([])
    expect(checkGitlabTrain('test:\n  script: [x]\n  rules:\n    - if: $CI_PIPELINE_SOURCE == "merge_request_event"\n')).toEqual([expect.stringContaining('bauherr/train')])
  })
  it('preflightTrain reads the workflows of the repo', async () => {
    const fake = new FakeBackend()
    fake.commit('acme/app', 'main', '.github/workflows/ci.yml', wf('  pull_request:', CI))
    expect(await preflightTrain(fake.forge, 'acme/app', 'github')).toMatchObject({ ok: false, problems: [expect.stringContaining('bauherr/train')] })
    fake.commit('acme/app', 'main', '.github/workflows/ci.yml', wf('  pull_request:\n  push:', CI))
    expect(await preflightTrain(fake.forge, 'acme/app', 'github')).toMatchObject({ ok: true, problems: [] })
  })
})

describe('preflightQueue and detectMergeMode (fake forge)', () => {
  const repo = 'acme/app'
  const setup = (workflow?: string, queue = true) => {
    const fake = new FakeBackend()
    fake.commit(repo, 'main', 'README.md', '#')
    if (workflow) fake.commit(repo, 'main', '.github/workflows/ci.yml', workflow)
    fake.setQueueSupport(repo, queue)
    fake.setRequiredChecks(repo, ['ci'])
    return fake.forge
  }

  it('without a native queue the mode is train and the problem says why', async () => {
    const { mode, preflight } = await detectMergeMode(setup(wf('  pull_request:\n  push:\n  merge_group:', CI), false), repo, 'github')
    expect(mode).toBe('train')
    expect(preflight.problems).toEqual([expect.stringContaining('no merge queue')])
  })

  it('a queue with a workflow lacking merge_group falls back to train and lists the problem', async () => {
    const { mode, preflight } = await detectMergeMode(setup(wf('  pull_request:\n  push:', CI)), repo, 'github')
    expect(mode).toBe('train')
    expect(preflight).toMatchObject({ ok: false, problems: [expect.stringContaining('no merge_group trigger')] })
  })

  it('a queue with a clean workflow set is queue mode', async () => {
    const { mode, preflight } = await detectMergeMode(setup(wf('  pull_request:\n  merge_group:', CI)), repo, 'github')
    expect(mode).toBe('queue')
    expect(preflight).toMatchObject({ ok: true, problems: [] })
  })

  it('GitLab: a queue-capable project without merge_request_event rules is not ready', async () => {
    const fake = new FakeBackend()
    fake.commit(repo, 'main', '.gitlab-ci.yml', 'test:\n  script: [x]\n')
    fake.setQueueSupport(repo, true)
    expect(await preflightQueue(fake.forge, repo, 'gitlab')).toMatchObject({ ok: false, problems: [expect.stringContaining('merge_request_event')] })
  })
})
