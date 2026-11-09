import { FakeBackend } from '@bauherr/adapters'
import { describe, expect, it } from 'vitest'
import { checkGitlabCi, checkWorkflows, detectMergeMode, preflightQueue } from '../src/lib/merge-preflight'

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
    const { mode, preflight } = await detectMergeMode(setup(wf('  pull_request:\n  merge_group:', CI), false), repo, 'github')
    expect(mode).toBe('train')
    expect(preflight.problems).toEqual([expect.stringContaining('no merge queue')])
  })

  it('a queue with a workflow lacking merge_group falls back to train and lists the problem', async () => {
    const { mode, preflight } = await detectMergeMode(setup(wf('  pull_request:', CI)), repo, 'github')
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
